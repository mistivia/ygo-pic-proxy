function Left(value) {
  return { type: Left, value };
}

function Right(value) {
  return { type: Right, value };
}

export { Left, Right };
