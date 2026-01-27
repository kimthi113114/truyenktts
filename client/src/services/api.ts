import { message } from 'antd';

const IS_PROD = import.meta.env.PROD;
const API_BASE_URL = IS_PROD ? 'https://truyenkttsv2.onrender.com' : '';

class ApiService {
    private baseUrl: string;

    constructor() {
        this.baseUrl = API_BASE_URL;
    }

    private getFullUrl(endpoint: string): string {
        if (endpoint.startsWith('http')) return endpoint;
        const e = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        return `${this.baseUrl}${e}`;
    }

    private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
        const url = this.getFullUrl(endpoint);
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };

        try {
            const response = await fetch(url, { ...options, headers });

            // Handle HTTP errors
            if (!response.ok) {
                const errorBody = await response.text();
                try {
                    const errorJson = JSON.parse(errorBody);
                    throw new Error(errorJson.message || `Error ${response.status}: ${response.statusText}`);
                } catch (e) {
                    throw new Error(`Error ${response.status}: ${response.statusText}`);
                }
            }

            // check if response is json
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                return await response.json();
            } else {
                return await response.text();
            }

        } catch (error: any) {
            console.error('API Request Error:', error);
            throw error;
        }
    }

    public async get(endpoint: string, options: RequestInit = {}): Promise<any> {
        return this.request(endpoint, { ...options, method: 'GET' });
    }

    public async post(endpoint: string, body: any, options: RequestInit = {}): Promise<any> {
        return this.request(endpoint, {
            ...options,
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    // Explicit method for streaming or special cases if needed, 
    // but often direct access to URL is needed for audio src
    public getBaseUrl(): string {
        return this.baseUrl;
    }

    public getUrl(endpoint: string): string {
        return this.getFullUrl(endpoint);
    }
}

export const api = new ApiService();
