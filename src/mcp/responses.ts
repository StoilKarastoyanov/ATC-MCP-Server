export function jsonContent(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function toolError(message: string) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}
