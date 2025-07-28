export class ApiException extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number,
    public readonly details?: any,
    public readonly suggestions?: string[],
  ) {
    super(message);
    this.name = 'ApiException';
  }
}
