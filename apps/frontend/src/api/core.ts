export class ApiCore {
  private baseUrl: string = 'http://127.0.0.1:4000';
  private token: string | null = null;

  constructor() {
    if (typeof window !== 'undefined' && (window as any).api) {
      (window as any).api.config.getServerUrl().then((url: string) => {
        if (url) this.baseUrl = url;
      }).catch(() => {});
      (window as any).api.storage.getToken().then((tok: string) => {
        if (tok) this.token = tok;
      }).catch(() => {});
    }
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
    if (typeof window !== 'undefined' && (window as any).api) {
      (window as any).api.config.setServerUrl(this.baseUrl).catch(() => {});
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined' && (window as any).api) {
      if (token) {
        (window as any).api.storage.setToken(token).catch(() => {});
      } else {
        (window as any).api.storage.clearToken().catch(() => {});
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let errBody: any = {};
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: res.statusText };
      }
      let message = errBody.message || `Request failed with status ${res.status}`;
      if (Array.isArray(errBody.details) && errBody.details.length > 0) {
        const detailStr = errBody.details
          .map((d: any) => (d.field && d.issue ? `${d.field}: ${d.issue}` : (d.issue || JSON.stringify(d))))
          .join('; ');
        message = `${message} (${detailStr})`;
      }
      const err = new Error(message) as Error & {
        statusCode: number;
        code?: string;
        details?: any;
      };
      err.statusCode = res.status;
      err.code = errBody.code;
      err.details = errBody.details;
      throw err;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      return (await res.text()) as unknown as T;
    }

    return res.json();
  }
}

export const apiCore = new ApiCore();
