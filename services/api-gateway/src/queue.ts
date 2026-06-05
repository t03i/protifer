export interface RedisCommands {
  zcard(key: string): Promise<number>
  zadd(key: string, score: number, member: string): Promise<number>
  zrem(key: string, ...members: string[]): Promise<number>
  hset(key: string, ...values: string[]): Promise<number>
  hget(key: string, field: string): Promise<string | null>
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>
  hdel(key: string, ...fields: string[]): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  incrby(key: string, amount: number): Promise<number>
  decrby(key: string, amount: number): Promise<number>
  get(key: string): Promise<string | null>
  eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number | string | null>
  zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
  ): Promise<string[]>
  zscore(key: string, member: string): Promise<string | null>
  scan(cursor: string, ...args: string[]): Promise<[string, string[]]>
}
