export function offerLabel(id: number, name: string): string {
  // Remove only the identical leading ID and its separator, not digits in a name.
  const rest = name.trim().replace(new RegExp(`^#?${id}(?=$|[\\s·:|_—–-])\\s*[·:|_—–-]?\\s*`), "");
  return rest ? `#${id} · ${rest}` : `#${id}`;
}
export const streamType = (value: string) =>
  ({ default: "Замыкающий", regular: "Обычный", forced: "Принудительный" }[value] ?? value);
export const streamSchema = (value: string) =>
  ({ landings: "Офферы", redirect: "Перенаправление" }[value] ?? value);
