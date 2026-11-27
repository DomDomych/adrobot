import { ApiError } from "../api/client";

const messages: Record<string, string> = {
  keitaro_error: "Keitaro отклонил запрос или вернул некорректный ответ.",
  keitaro_timeout: "Keitaro не ответил вовремя. Проверьте соединение.",
  keitaro_unavailable: "Keitaro недоступен. Проверьте соединение и настройки сервера.",
  inactive_offer: "Оффер не найден или больше не активен. Выберите другой оффер.",
  journal_unavailable: "Хранилище операций недоступно. Запись в Keitaro не начиналась.",
  creation_unknown: "Результат создания неизвестен. Проверьте Keitaro перед повторной отправкой.",
  cleanup_failed: "Кампания могла остаться незавершённой. Проверьте её в Keitaro.",
  creation_rolled_back: "Создание потоков не удалось; неполная кампания удалена.",
  not_found: "Кампания или другой запрошенный объект не найден.",
  invalid_upstream: "Keitaro вернул некорректные данные. Изменения не подтверждены.",
  stream_not_found: "Поток не найден. Загрузите актуальное состояние редактора.",
};
export function errorMessage(error: Error): string {
  return error instanceof ApiError ? messages[error.code] ?? error.message : error.message;
}
export function distributionMessage(message: string): string {
  return ({
    "At least one active offer is required": "Нужен хотя бы один активный оффер.",
    "Active offer shares must sum to 100%": "Сумма долей активных офферов должна быть 100%.",
    "Removed offers must have zero share and cannot be pinned": "Удалённые офферы должны иметь долю 0% без закрепления.",
  }[message] ?? message);
}
