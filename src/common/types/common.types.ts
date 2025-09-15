// Error response interfaces
export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

// Utility type for database to API response transformation
export type ApiResponse<T> = {
  data?: T;
  error?: ApiErrorResponse;
};
