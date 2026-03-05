import type { AxiosInstance } from "axios";
import type winston from "winston";

export const BITBUCKET_DEFAULT_PAGELEN = 10;
export const BITBUCKET_MAX_PAGELEN = 100;
export const BITBUCKET_ALL_ITEMS_CAP = 1000;

export type BitbucketInstanceType = "cloud" | "server";

export interface PaginationRequestOptions {
  pagelen?: number;
  page?: number;
  all?: boolean;
  params?: Record<string, any>;
  defaultPagelen?: number;
  maxItems?: number;
  description?: string;
}

export interface PaginatedValuesResult<T> {
  values: T[];
  page?: number;
  pagelen: number;
  next?: string;
  fetchedPages: number;
  totalFetched: number;
  previous?: string;
}

interface PendingRequestConfig {
  url: string;
  params?: Record<string, any>;
}

export class BitbucketPaginator {
  constructor(
    private readonly api: AxiosInstance,
    private readonly logger: winston.Logger,
    private readonly instanceType: BitbucketInstanceType = "cloud"
  ) {}

  private get isServer(): boolean {
    return this.instanceType === "server";
  }

  async fetchValues<T>(
    path: string,
    options: PaginationRequestOptions = {}
  ): Promise<PaginatedValuesResult<T>> {
    const {
      pagelen,
      page,
      all = false,
      params = {},
      defaultPagelen = BITBUCKET_DEFAULT_PAGELEN,
      maxItems = BITBUCKET_ALL_ITEMS_CAP,
      description,
    } = options;

    const resolvedPagelen = this.normalizePagelen(
      pagelen ?? defaultPagelen
    );

    // Build initial request params according to instance type.
    // Bitbucket Server uses `limit`/`start`; Cloud uses `pagelen`/`page`.
    const requestParams: Record<string, any> = { ...params };
    if (this.isServer) {
      requestParams.limit = resolvedPagelen;
      if (page !== undefined) {
        // Server uses a 0-based byte offset (`start`), not a page number.
        requestParams.start = (page - 1) * resolvedPagelen;
      }
    } else {
      requestParams.pagelen = resolvedPagelen;
      if (page !== undefined) {
        requestParams.page = page;
      }
    }

    const shouldFetchAll = all === true && page === undefined;
    const requestDescriptor: PendingRequestConfig = {
      url: path,
      params: requestParams,
    };

    if (!shouldFetchAll) {
      const response = await this.performRequest(
        requestDescriptor,
        description
      );
      const values = this.extractValues<T>(response.data);
      return {
        values,
        page: response.data?.page ?? page,
        pagelen: response.data?.pagelen ?? response.data?.limit ?? resolvedPagelen,
        next: response.data?.next,
        previous: response.data?.previous,
        fetchedPages: 1,
        totalFetched: values.length,
      };
    }

    const aggregated: T[] = [];
    let fetchedPages = 0;
    let nextRequest: PendingRequestConfig | undefined = requestDescriptor;
    let firstPageMeta: {
      page?: number;
      pagelen: number;
      previous?: string;
    } = { pagelen: resolvedPagelen };

    while (nextRequest && aggregated.length < maxItems) {
      const response = await this.performRequest(nextRequest, description, {
        page: fetchedPages + 1,
      });
      fetchedPages += 1;

      if (fetchedPages === 1) {
        firstPageMeta = {
          page: response.data?.page,
          pagelen: response.data?.pagelen ?? response.data?.limit ?? resolvedPagelen,
          previous: response.data?.previous,
        };
      }

      const values = this.extractValues<T>(response.data);
      aggregated.push(...values);

      // Determine whether there are more pages.
      // Server: uses `isLastPage` + `nextPageStart`; Cloud: uses `next` URL.
      const hasMore = this.isServer
        ? response.data?.isLastPage === false && response.data?.nextPageStart !== undefined
        : Boolean(response.data?.next);

      if (!hasMore) {
        nextRequest = undefined;
        break;
      }

      if (aggregated.length >= maxItems) {
        this.logger.debug("Bitbucket pagination cap reached", {
          description: description ?? path,
          maxItems,
        });
        nextRequest = undefined;
        break;
      }

      this.logger.debug("Following Bitbucket pagination next link", {
        description: description ?? path,
        next: this.isServer ? `start=${response.data.nextPageStart}` : response.data.next,
        fetchedPages,
        totalFetched: aggregated.length,
      });

      if (this.isServer) {
        // For Server, re-use the same path but advance the `start` offset.
        const serverParams = { ...requestDescriptor.params };
        serverParams.start = response.data.nextPageStart;
        nextRequest = { url: path, params: serverParams };
      } else {
        nextRequest = { url: response.data.next };
      }
    }

    if (aggregated.length > maxItems) {
      aggregated.length = maxItems;
    }

    return {
      values: aggregated,
      page: firstPageMeta.page,
      pagelen: firstPageMeta.pagelen,
      previous: firstPageMeta.previous,
      fetchedPages,
      totalFetched: aggregated.length,
    };
  }

  private async performRequest(
    request: PendingRequestConfig,
    description?: string,
    extra?: Record<string, any>
  ) {
    this.logger.debug("Calling Bitbucket API", {
      description: description ?? request.url,
      url: request.url,
      params: request.params,
      ...extra,
    });
    const config = request.params ? { params: request.params } : undefined;
    return this.api.get(request.url, config);
  }

  private extractValues<T>(data: any): T[] {
    if (Array.isArray(data?.values)) {
      return data.values as T[];
    }
    if (Array.isArray(data)) {
      return data as T[];
    }
    return [];
  }

  private normalizePagelen(value?: number): number {
    if (value === undefined || Number.isNaN(value)) {
      return BITBUCKET_DEFAULT_PAGELEN;
    }
    const integer = Math.floor(value);
    if (!Number.isFinite(integer) || integer < 1) {
      return 1;
    }
    return Math.min(integer, BITBUCKET_MAX_PAGELEN);
  }
}
