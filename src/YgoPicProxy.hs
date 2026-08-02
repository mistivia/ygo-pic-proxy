{-# LANGUAGE OverloadedStrings #-}

module YgoPicProxy
  ( AppState
  , newAppState
  , app
  , worker
  , parseId
  ) where

import Control.Concurrent.Chan (Chan, newChan, readChan, writeChan)
import Control.Concurrent.MVar (MVar, modifyMVar, newMVar, withMVar)
import Control.Exception (IOException, SomeException, catch, try)
import Control.Monad (forever)
import qualified Data.ByteString.Lazy as BL
import Data.Char (isDigit)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time.Clock.POSIX (getPOSIXTime)
import Database.SQLite.Simple (Connection, Only (..), execute, execute_, open, query)
import Network.HTTP.Client (Manager, httpLbs, parseRequest, responseBody, responseStatus, responseTimeout, responseTimeoutMicro)
import Network.HTTP.Client.TLS (newTlsManager)
import Network.HTTP.Types (status200, status404, status500)
import Network.Wai (Application, Response, ResponseReceived, pathInfo, responseFile, responseLBS)
import System.Directory (createDirectoryIfMissing, doesFileExist, removeFile, renameFile)
import System.FilePath (takeFileName, (</>))
import System.Process (callProcess)
import Text.Read (readMaybe)

data AppState = AppState
  { asChan    :: Chan FilePath
  , asDb      :: Connection
  , asLocks   :: MVar (Map.Map String (MVar ()))
  , asManager :: Manager
  }

newAppState :: IO AppState
newAppState = do
  createDirectoryIfMissing True "cache"
  createDirectoryIfMissing True "tmp"
  conn <- open "ygo-pic-proxy.db"
  initDb conn
  mgr <- newTlsManager
  chan <- newChan
  locks <- newMVar Map.empty
  pure (AppState chan conn locks mgr)

initDb :: Connection -> IO ()
initDb conn = do
  execute_ conn "PRAGMA journal_mode=WAL;"
  execute_ conn "PRAGMA busy_timeout=5000;"
  execute_ conn "CREATE TABLE IF NOT EXISTS notexist (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL)"

app :: AppState -> Application
app st req respond =
  case pathInfo req of
    [name] ->
      case parseId name of
        Just i  -> handleImage st i respond
        Nothing -> respond (responseLBS status404 [] "not found")
    _ -> respond (responseLBS status404 [] "not found")

handleImage :: AppState -> String -> (Response -> IO ResponseReceived) -> IO ResponseReceived
handleImage st cid respond = do
  let cacheFile = "cache" </> (cid ++ ".jpg")
  cached <- doesFileExist cacheFile
  if cached
    then respond (responseFile status200 [("Content-Type", "image/jpeg")] cacheFile Nothing)
    else withKeyLock (asLocks st) cid $ do
      cached' <- doesFileExist cacheFile
      if cached'
        then respond (responseFile status200 [("Content-Type", "image/jpeg")] cacheFile Nothing)
        else fetchMissing
  where
    fetchMissing :: IO ResponseReceived
    fetchMissing = do
      now <- floor <$> getPOSIXTime
      mTs <- getNotExist (asDb st) cid
      case mTs of
        Just ts | now - ts < 3600 -> respond (responseLBS status404 [] "not found")
        _ -> do
          let webpFile = "tmp" </> (cid ++ ".webp")
          dl <- try (downloadWebp (asManager st) cid webpFile) :: IO (Either SomeException DownloadResult)
          case dl of
            Left _ -> respond (responseLBS status500 [] "internal error")
            Right DownloadNotFound -> do
              setNotExist (asDb st) cid now
              respond (responseLBS status404 [] "not found")
            Right DownloadHttpError -> respond (responseLBS status500 [] "internal error")
            Right DownloadOk -> convertAndServe webpFile
    convertAndServe :: FilePath -> IO ResponseReceived
    convertAndServe webpFile = do
      let jpgFile = "tmp" </> (cid ++ ".jpg")
      conv <- try (callProcess "magick" [webpFile, jpgFile]) :: IO (Either SomeException ())
      case conv of
        Left _ -> respond (responseLBS status500 [] "internal error")
        Right () -> do
          img <- BL.readFile jpgFile
          writeChan (asChan st) jpgFile
          respond (responseLBS status200 [("Content-Type", "image/jpeg")] img)

data DownloadResult = DownloadOk | DownloadNotFound | DownloadHttpError

downloadWebp :: Manager -> String -> FilePath -> IO DownloadResult
downloadWebp mgr cid dest = do
  req0 <- parseRequest ("https://cdn.233.momobako.com/ygoimg/ygopro/" ++ cid ++ ".webp!/format/webp/fw/400/quality/85")
  let req = req0 { responseTimeout = responseTimeoutMicro 30000000 }
  resp <- httpLbs req mgr
  let st = responseStatus resp
  if st == status404
    then pure DownloadNotFound
    else if st /= status200
      then pure DownloadHttpError
      else do
        BL.writeFile dest (responseBody resp)
        pure DownloadOk

getNotExist :: Connection -> String -> IO (Maybe Integer)
getNotExist conn cid = do
  rows <- query conn "SELECT timestamp FROM notexist WHERE id = ?" (Only cid) :: IO [Only String]
  case rows of
    Only tsStr : _ -> pure (readMaybe tsStr)
    []             -> pure Nothing

setNotExist :: Connection -> String -> Integer -> IO ()
setNotExist conn cid ts =
  execute conn "INSERT OR REPLACE INTO notexist (id, timestamp) VALUES (?, ?)" (cid, show ts)

worker :: AppState -> IO ()
worker st = forever $ do
  tmpJpg <- readChan (asChan st)
  let name = takeFileName tmpJpg
      cacheJpg = "cache" </> name
  exists <- doesFileExist cacheJpg
  if exists
    then removeQuietly tmpJpg
    else renameFile tmpJpg cacheJpg `catch` ignoreIO
  where
    removeQuietly :: FilePath -> IO ()
    removeQuietly p = removeFile p `catch` ignoreIO
    ignoreIO :: IOException -> IO ()
    ignoreIO _ = pure ()

withKeyLock :: MVar (Map.Map String (MVar ())) -> String -> IO a -> IO a
withKeyLock locks key action = do
  mv <- modifyMVar locks $ \m ->
    case Map.lookup key m of
      Just v  -> pure (m, v)
      Nothing -> do
        v <- newMVar ()
        pure (Map.insert key v m, v)
  withMVar mv $ \_ -> action

parseId :: Text -> Maybe String
parseId name = do
  s <- T.stripSuffix ".jpg" name
  let str = T.unpack s
  if not (null str) && length str <= 10 && all isDigit str
    then Just str
    else Nothing
