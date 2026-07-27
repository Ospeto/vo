export function once<T>(callback: (value: T) => void): (value: T) => boolean {
  let completed = false;
  return (value) => {
    if (completed) return false;
    completed = true;
    callback(value);
    return true;
  };
}
