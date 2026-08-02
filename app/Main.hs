module Main (main) where

import Control.Concurrent (forkIO)
import Network.Wai.Handler.Warp (run)
import YgoPicProxy (app, newAppState, worker)

main :: IO ()
main = do
  st <- newAppState
  _ <- forkIO (worker st)
  run 8080 (app st)
