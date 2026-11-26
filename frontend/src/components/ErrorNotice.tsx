import { Alert, Button } from "antd";
import { ApiError } from "../api/client";
export function ErrorNotice({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <Alert
      showIcon
      type="error"
      role="alert"
      title="Не удалось выполнить запрос"
      description={
        <div className="stack-small">
          <div>{error.message}</div>
          {error instanceof ApiError && (
            <small>
              Код: {error.code}
              {error.campaignId !== null
                ? ` · Кампания #${error.campaignId}`
                : ""}
            </small>
          )}
          {retry && (
            <div>
              <Button onClick={retry}>Повторить загрузку</Button>
            </div>
          )}
        </div>
      }
    />
  );
}
