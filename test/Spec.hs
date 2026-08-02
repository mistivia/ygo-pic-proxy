module Main (main) where

import Test.HUnit
import YgoPicProxy (parseId)
import qualified Data.Text as T

testValidId :: Test
testValidId = TestCase (assertEqual "valid id" (Just "12345") (parseId (T.pack "12345.jpg")))

testTooLongId :: Test
testTooLongId = TestCase (assertEqual "too long id" Nothing (parseId (T.pack "12345678901.jpg")))

testNonDigitId :: Test
testNonDigitId = TestCase (assertEqual "non-digit id" Nothing (parseId (T.pack "abc.jpg")))

testMissingExt :: Test
testMissingExt = TestCase (assertEqual "missing .jpg" Nothing (parseId (T.pack "12345")))

testEmptyId :: Test
testEmptyId = TestCase (assertEqual "empty id" Nothing (parseId (T.pack ".jpg")))

main :: IO ()
main = do
  _ <- runTestTT (TestList [testValidId, testTooLongId, testNonDigitId, testMissingExt, testEmptyId])
  pure ()
