module Main (main) where

import Test.HUnit
import YgoPicProxy (greet)

testGreet :: Test
testGreet = TestCase (assertEqual "greet should say hello" "Hello, ygo-pic-proxy!" (greet "ygo-pic-proxy"))

main :: IO ()
main = do
    _ <- runTestTT testGreet
    return ()
