{-# LANGUAGE OverloadedStrings #-}

module YgoPicProxy
  ( AppState
  , newAppState
  , app
  , worker
  , parseId
  ) where

import Control.Concurrent.Chan (Chan, newChan, readChan, writeChan)
import Control.Exception (IOException, SomeException, bracket, bracketOnError, catch, finally, try)
import Control.Monad (forever)
import qualified Data.ByteString.Lazy as BL
import Data.Char (isDigit)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time.Clock.POSIX (getPOSIXTime)
import Database.SQLite.Simple (Connection, Only (..), execute, execute_, open, query)
import Network.HTTP.Client (Manager, httpLbs, parseRequest, responseBody, responseStatus, responseTimeout, responseTimeoutMicro)
import Network.HTTP.Client.TLS (newTlsManager)
import Network.HTTP.Types (status200, status404, status500)
import Network.Wai (Application, Response, ResponseReceived, pathInfo, responseFile, responseLBS)
import System.Directory (copyFile, createDirectoryIfMissing, doesFileExist, getTemporaryDirectory, removeFile)
import System.FilePath ((</>))
import System.IO (hClose, openTempFile)
import System.Process (callProcess)
import Text.Read (readMaybe)

data AppState = AppState{
  asChan    :: Chan (String, FilePath),
  asDb      :: Connection,
  asManager :: Manager
}

newAppState :: IO AppState
newAppState = do
  createDirectoryIfMissing True "cache"
  conn <- open "ygo-pic-proxy.db"
  initDb conn
  mgr <- newTlsManager
  chan <- newChan
  pure (AppState chan conn mgr)

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
    else fetchMissing
  where
    fetchMissing :: IO ResponseReceived
    fetchMissing = do
      now <- floor <$> getPOSIXTime
      mTs <- getNotExist (asDb st) cid
      case mTs of
        Just ts | now - ts < 3600 -> respond (responseLBS status404 [] "not found")
        _ -> withTempFile ("ygo-" ++ cid ++ ".webp") $ \webpFile -> do
          dl <- try (downloadWebp (asManager st) cid webpFile) :: IO (Either SomeException DownloadResult)
          case dl of
            Left _ -> respond (responseLBS status500 [] "internal error, download failed")
            Right DownloadNotFound -> do
              setNotExist (asDb st) cid now
              respond (responseLBS status404 [] "not found")
            Right DownloadHttpError -> respond (responseLBS status500 [] "internal error, download http error")
            Right DownloadOk ->
              withTempFileOnError ("ygo-" ++ cid ++ ".jpg") $ \jpgFile -> do
                callProcess "magick" [webpFile, jpgFile]
                img <- BL.readFile jpgFile
                writeChan (asChan st) (cid, jpgFile)
                respond (responseLBS status200 [("Content-Type", "image/jpeg")] img)
              `catch` \(_ :: SomeException) ->
                respond (responseLBS status500 [] "internal error, magick exception")

data DownloadResult = DownloadOk | DownloadNotFound | DownloadHttpError

ignoreIO :: IOException -> IO ()
ignoreIO _ = pure ()

removeQuietly :: FilePath -> IO ()
removeQuietly p = catch (removeFile p)  ignoreIO

acquireTempFile :: String -> IO FilePath
acquireTempFile template = do
  tmpDir <- getTemporaryDirectory
  (p, h) <- openTempFile tmpDir template
  hClose h
  pure p

withTempFile :: String -> (FilePath -> IO a) -> IO a
withTempFile template = bracket (acquireTempFile template) removeQuietly

withTempFileOnError :: String -> (FilePath -> IO a) -> IO a
withTempFileOnError template = bracketOnError (acquireTempFile template) removeQuietly

downloadWebp :: Manager -> String -> FilePath -> IO DownloadResult
downloadWebp mgr cid dest = do
  req0 <- parseRequest ("https://cdn.233.momobako.com/ygoimg/ygopro/" ++ cid ++ ".webp!/format/webp/fw/400/quality/85")
  let req = req0 { responseTimeout = responseTimeoutMicro 30000000 }
  resp <- httpLbs req mgr
  let st = responseStatus resp
  if st == status404 then
    pure DownloadNotFound
  else if st /= status200 then
    pure DownloadHttpError
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
  (cid, tmpJpg) <- readChan (asChan st)
  flip finally (removeQuietly tmpJpg) $ do
    let cacheJpg = "cache" </> (cid ++ ".jpg")
    exists <- doesFileExist cacheJpg
    if exists then pure ()
    else catch (copyFile tmpJpg cacheJpg) ignoreIO

parseId :: Text -> Maybe String
parseId name = do
  s <- T.stripSuffix ".jpg" name
  let str = T.unpack s
  if not (null str) && length str <= 10 && all isDigit str then
    Just str
  else Nothing
