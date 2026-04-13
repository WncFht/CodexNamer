export function toErrorPayload(error: unknown): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (error instanceof Error) {
    if (error.message.startsWith("Unknown session:")) {
      return {
        statusCode: 404,
        body: {
          error: "not_found",
          message: error.message,
        },
      };
    }

    return {
      statusCode: 400,
      body: {
        error: "request_failed",
        message: error.message,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "internal_error",
      message: "Unknown error",
    },
  };
}
