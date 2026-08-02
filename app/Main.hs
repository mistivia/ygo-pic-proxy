{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.Concurrent (forkIO)
import Data.Ini (Ini, lookupValue, readIniFile)
import Data.String (fromString)
import qualified Data.Text as T
import qualified Data.Text.Read as TR
import Network.Wai.Handler.Warp
  ( Port
  , Settings
  , defaultSettings
  , runSettings
  , setHost
  , setPort
  )
import YgoPicProxy (app, newAppState, worker)

main :: IO ()
main = do
  settings <- loadSettings "config.ini"
  st <- newAppState
  _ <- forkIO (worker st)
  runSettings settings (app st)

loadSettings :: FilePath -> IO Settings
loadSettings path = do
  eIni <- readIniFile path
  case eIni of
    Left err -> fail $ "Failed to read " ++ path ++ ": " ++ err
    Right ini ->
      case parseSettings ini of
        Left err -> fail $ "Invalid config " ++ path ++ ": " ++ err
        Right settings -> pure settings

parseSettings :: Ini -> Either String Settings
parseSettings ini = do
  hostStr <- T.strip <$> lookupValue "server" "host" ini
  portNum <- parsePort =<< lookupValue "server" "port" ini
  pure $ setHost (fromString (T.unpack hostStr)) $ setPort portNum defaultSettings

parsePort :: T.Text -> Either String Port
parsePort t =
  case TR.decimal (T.strip t) of
    Right (n, rest)
      | T.null (T.strip rest) && n > 0 && n <= 65535 -> Right (fromIntegral n)
    _ -> Left $ "invalid port: " ++ T.unpack t
