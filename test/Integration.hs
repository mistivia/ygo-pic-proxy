{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.Concurrent (forkIO)
import Control.Exception (SomeException, bracket, catch, finally, try)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL
import Data.Time.Clock.POSIX (getPOSIXTime)
import Database.SQLite.Simple (execute, open)
import Network.HTTP.Client
  ( HttpException
  , Manager
  , defaultManagerSettings
  , httpLbs
  , newManager
  , parseRequest
  , responseBody
  , responseHeaders
  , responseStatus
  , responseTimeout
  , responseTimeoutMicro
  )
import Network.HTTP.Client.TLS (newTlsManager)
import Network.HTTP.Types (hContentType, statusCode, status404)
import Network.Socket
  ( Family (AF_INET)
  , SockAddr (SockAddrInet)
  , Socket
  , SocketType (Stream)
  , bind
  , close
  , defaultProtocol
  , listen
  , maxListenQueue
  , socket
  , socketPort
  , tupleToHostAddress
  )
import Network.Wai.Handler.Warp (defaultSettings, runSettingsSocket)
import System.Directory
  ( createDirectoryIfMissing
  , getTemporaryDirectory
  , removePathForcibly
  , withCurrentDirectory
  )
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.FilePath ((</>))
import Test.HUnit
import YgoPicProxy (app, newAppState, worker)

-- | 在独立临时目录中启动服务，测试结束时自动清理
withServer :: (Manager -> Int -> FilePath -> IO a) -> IO a
withServer test = do
  base <- getTemporaryDirectory
  now <- floor <$> getPOSIXTime
  let dir = base </> ("ygo-pic-proxy-it-" ++ show now)
  createDirectoryIfMissing True dir
  flip finally (cleanupDir dir) $
    withCurrentDirectory dir $
      bracket (startServer dir) cleanupSocket (\(mgr, port, _) -> test mgr port dir)
  where
    cleanupSocket :: (Manager, Int, Socket) -> IO ()
    cleanupSocket (_, _, sock) = close sock `catch` (\ (_ :: SomeException) -> pure ())
    cleanupDir :: FilePath -> IO ()
    cleanupDir d = removePathForcibly d `catch` (\ (_ :: SomeException) -> pure ())

-- | 启动服务：AppState + worker + socket 监听，返回 manager / 端口 / socket
startServer :: FilePath -> IO (Manager, Int, Socket)
startServer dir = do
  st <- newAppState
  _ <- forkIO (worker st)
  sock <- socket AF_INET Stream defaultProtocol
  bind sock (SockAddrInet 0 (tupleToHostAddress (0, 0, 0, 0)))
  listen sock maxListenQueue
  port <- fromIntegral <$> socketPort sock
  _ <- forkIO (runSettingsSocket defaultSettings sock (app st))
  mgr <- newManager defaultManagerSettings
  pure (mgr, port, sock)

type Resp = (Int, BL.ByteString, Maybe BS.ByteString)

-- | 发起 HTTP 请求，返回 (状态码, 响应体, Content-Type)
request :: Manager -> Int -> String -> IO Resp
request mgr port path = do
  req <- parseRequest ("http://127.0.0.1:" ++ show port ++ path)
  resp <- httpLbs req mgr
  pure
    ( statusCode (responseStatus resp)
    , responseBody resp
    , lookup hContentType (responseHeaders resp)
    )

-- ============ 测试用例 ============

-- 1. 已缓存的卡片：直接命中磁盘缓存
testCachedCard :: Manager -> Int -> FilePath -> IO ()
testCachedCard mgr port dir = do
  let cacheDir = dir </> "cache"
      cacheJpg = cacheDir </> "1111111.jpg"
  createDirectoryIfMissing True cacheDir
  BS.writeFile cacheJpg "fake-jpeg-cache-data"
  (code, body, ct) <- request mgr port "/1111111.jpg"
  assertEqual "cached status" 200 code
  assertEqual "cached body" "fake-jpeg-cache-data" (BL.toStrict body)
  assertEqual "cached content-type" (Just "image/jpeg") ct
  -- 第二次请求仍应命中
  (code2, _, _) <- request mgr port "/1111111.jpg"
  assertEqual "cached twice status" 200 code2

-- 2. 数据库里已记住的不存在的卡片：直接 404，不访问上游
testKnownMissing :: Manager -> Int -> FilePath -> IO ()
testKnownMissing mgr port dir = do
  conn <- open (dir </> "ygo-pic-proxy.db")
  now <- floor <$> getPOSIXTime
  execute conn "INSERT OR REPLACE INTO notexist (id, timestamp) VALUES (?, ?)" ("999999999" :: String, show now)
  (code, body, _) <- request mgr port "/999999999.jpg"
  assertEqual "known missing status" 404 code
  assertEqual "known missing body" "not found" (BL.toStrict body)

-- 3. 从未请求过的不存在的卡片：访问上游 CDN 后 404，并记住结果
-- 若处于无网络环境（如 nix 构建沙箱），则跳过该用例
testNewMissing :: Manager -> Int -> FilePath -> IO ()
testNewMissing mgr port _ = do
  netOk <- try probeUpstream :: IO (Either HttpException Bool)
  case netOk of
    Left e -> putStrLn ("SKIP testNewMissing: no network access to upstream CDN: " ++ show e)
    Right False -> putStrLn "SKIP testNewMissing: unexpected upstream response"
    Right True -> do
      -- 使用极不可能存在的 ID（10 位数字，超长 ID 边界测试）
      (code, body, _) <- request mgr port "/9999999999.jpg"
      assertEqual "new missing status" 404 code
      assertEqual "new missing body" "not found" (BL.toStrict body)
      -- 再次请求应走数据库记忆，依然 404
      (code2, _, _) <- request mgr port "/9999999999.jpg"
      assertEqual "new missing retry status" 404 code2
  where
    -- 用已知存在的卡片 ID 探测上游连通性
    probeUpstream :: IO Bool
    probeUpstream = do
      mgr' <- newTlsManager
      req <- parseRequest "https://cdn.233.momobako.com/ygoimg/ygopro/46986414.webp!/format/webp/fw/400/quality/85"
      let req' = req { responseTimeout = responseTimeoutMicro 3000000 }
      resp <- httpLbs req' mgr'
      pure (responseStatus resp /= status404)

-- 4. 非法 ID：非数字 / 缺后缀 / 超长
testInvalidIds :: Manager -> Int -> FilePath -> IO ()
testInvalidIds mgr port _ = do
  (code, _, _) <- request mgr port "/abc.jpg"
  assertEqual "non-digit status" 404 code
  (code2, _, _) <- request mgr port "/12345"
  assertEqual "missing ext status" 404 code2
  (code3, _, _) <- request mgr port "/12345678901.jpg"
  assertEqual "too long status" 404 code3
  (code4, _, _) <- request mgr port "/.jpg"
  assertEqual "empty id status" 404 code4

-- 5. 根路径与深层路径
testRootBadPath :: Manager -> Int -> FilePath -> IO ()
testRootBadPath mgr port _ = do
  (code, _, _) <- request mgr port "/"
  assertEqual "root status" 404 code
  (code2, _, _) <- request mgr port "/foo/1234.jpg"
  assertEqual "nested status" 404 code2

-- ============ 入口 ============

allTests :: [Test]
allTests =
  [ TestCase (withServer testCachedCard)
  , TestCase (withServer testKnownMissing)
  , TestCase (withServer testNewMissing)
  , TestCase (withServer testInvalidIds)
  , TestCase (withServer testRootBadPath)
  ]

main :: IO ()
main = do
  args <- getArgs
  let sel = case args of
        ["cached"]  -> [TestCase (withServer testCachedCard)]
        ["missing"] -> [TestCase (withServer testKnownMissing), TestCase (withServer testNewMissing)]
        ["invalid"] -> [TestCase (withServer testInvalidIds)]
        ["paths"]   -> [TestCase (withServer testRootBadPath)]
        _           -> allTests
  counts <- runTestTT (TestList sel)
  if errors counts + failures counts == 0
    then putStrLn "ALL INTEGRATION TESTS PASSED"
    else exitFailure
