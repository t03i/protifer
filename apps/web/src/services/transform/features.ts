export function findIndexes(
  str: string,
  letters: string[],
): Record<string, number[]> {
  const result: Record<string, number[]> = {}
  const letterSet = new Set(letters)
  for (const letter of letters) result[letter] = []

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!
    if (letterSet.has(ch)) result[ch]!.push(i + 1)
  }

  return result
}

export function findRanges(array: number[]): Array<{ x: number; y: number }> {
  if (array.length === 0) return []

  const sorted = [...array].sort((a, b) => a - b)
  const ranges: Array<{ x: number; y: number }> = [
    { x: sorted[0]!, y: sorted[0]! },
  ]

  for (let i = 1; i < sorted.length; i++) {
    const current = ranges[ranges.length - 1]!
    if (sorted[i]! <= current.y + 1) {
      current.y = sorted[i]!
    } else {
      ranges.push({ x: sorted[i]!, y: sorted[i]! })
    }
  }

  return ranges
}
