type PaginationParams = {
  limit: number
  cursor?: { id: string }
  skip: number
  take: number
}

type PaginationResult<T> = {
  data: T[]
  has_more: boolean
  first_id?: string
  last_id?: string
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
  idToUuid: (id: string) => string,
  defaultLimit = 50
): PaginationParams {
  const limitParam = searchParams.get("limit")
  const afterId = searchParams.get("after_id")
  const beforeId = searchParams.get("before_id")

  const limit = limitParam ? parseInt(limitParam) : defaultLimit

  if (afterId) {
    return {
      limit,
      cursor: { id: idToUuid(afterId) },
      skip: 1,
      take: limit + 1,
    }
  }

  if (beforeId) {
    return {
      limit,
      cursor: { id: idToUuid(beforeId) },
      skip: 1,
      take: -(limit + 1),
    }
  }

  return {
    limit,
    cursor: undefined,
    skip: 0,
    take: limit + 1,
  }
}

export function paginatedResponse<T>(items: T[], limit: number, getId: (item: T) => string): PaginationResult<T> {
  const hasMore = items.length > limit
  const data = hasMore ? items.slice(0, limit) : items

  return {
    data,
    has_more: hasMore,
    ...(data.length > 0 && {
      first_id: getId(data[0]),
      last_id: getId(data[data.length - 1]),
    }),
  }
}
