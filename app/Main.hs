module Main (main) where

import YgoPicProxy (greet)

main :: IO ()
main = putStrLn (greet "ygo-pic-proxy")
