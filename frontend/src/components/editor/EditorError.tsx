import { Alert } from "antd";
import { ApiError } from "../../api/client";
import { uncertainEditorError } from "./useCampaignEditor";

const messages: Record<string, string> = {
  no_free_share:
    "Нет свободной доли для оффера. Измените закреплённые доли или снимите закрепление.",
  last_offer: "Нельзя удалить последний активный оффер.",
  duplicate_offer: "Этот оффер уже подключён к потоку.",
  invalid_distribution:
    "Распределение долей некорректно. Проверьте значения и закрепления.",
  offer_not_found: "Оффер не найден. Выберите другой оффер.",
  inactive_offer: "Оффер больше не активен. Выберите другой оффер.",
  revision_conflict:
    "Редактор изменён в другой вкладке. Запрошено актуальное состояние; действие не повторялось. Проверьте данные перед следующим действием.",
  draft_conflict:
    "Получение потоков из Keitaro требует отбрасывания черновиков.",
  upstream_conflict:
    "Поток изменён в Keitaro. Черновик сохранён. Проверьте Keitaro; Fetch Streams from KT заменит черновик только после вашего подтверждения.",
  editor_storage_unavailable:
    "Хранилище редактора недоступно или занято. Перед продолжением необходимо загрузить актуальное состояние.",
  publication_failed: "Keitaro отклонил публикацию. Черновик сохранён.",
};
export function EditorError({
  error,
  publishing,
}: {
  error: Error;
  publishing: boolean;
}) {
  const uncertain = uncertainEditorError(error);
  const title =
    publishing && uncertain
      ? "Результат публикации не подтверждён"
      : "Действие не выполнено или не подтверждено";
  return (
    <Alert
      type={uncertain ? "warning" : "error"}
      showIcon
      role="alert"
      title={title}
      description={
        <div className="stack-small">
          <p>
            {publishing && uncertain
              ? "Проверьте поток через View in KT. Запрошено актуальное состояние редактора. Если черновик остался, можно явно повторить Push to KT: backend сверит уже применённые изменения. Автоматического повтора нет."
              : error instanceof ApiError && messages[error.code]
                ? messages[error.code]
                : error.message}
          </p>
          {uncertain && !publishing && (
            <p>
              Запрошено состояние через GET, чтобы уточнить результат. Действие
              автоматически не повторяется.
            </p>
          )}
          {error instanceof ApiError && (
            <small>
              {error.code} · {error.message}
            </small>
          )}
        </div>
      }
    />
  );
}
