/**
 * One extra read. A successful value is returned immediately.
 * An empty value is read again before it counts as empty.
 * A thrown read is tried once more. An empty result after an error is thrown:
 * that is not the same as an account with no rows.
 */
export async function retryRead<T>(
  label: string,
  load: () => Promise<T>,
  isEmpty?: (value: T) => boolean,
): Promise<T> {
  const empty = (value: T) => Boolean(isEmpty?.(value));
  try {
    const value = await load();
    if (!empty(value)) return value;
    try {
      return await load();
    } catch (error) {
      console.error(`${label} empty recheck`, error);
      throw error;
    }
  } catch (error) {
    console.error(label, error);
    try {
      const again = await load();
      if (empty(again)) throw new Error(`${label} empty after error`);
      return again;
    } catch (again) {
      console.error(`${label} retry`, again);
      throw again;
    }
  }
}
