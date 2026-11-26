import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, Spin } from "antd";
import { api } from "../api/client";
import type { Offer } from "../api/types";
import { ErrorNotice } from "./ErrorNotice";
interface Props {
  id?: string;
  value?: number;
  onChange?: (value: number | undefined) => void;
  disabled?: boolean;
  excludedIds?: number[];
}
export function OfferSelect({
  id,
  value,
  onChange,
  disabled,
  excludedIds = [],
}: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<Offer>();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  const offers = useQuery({
    queryKey: ["offers", debounced],
    queryFn: ({ signal }) => api.offers(debounced, signal),
    enabled: search.trim() === debounced,
  });
  const waiting = search.trim() !== debounced || offers.isFetching;
  const results =
    waiting || offers.isError
      ? []
      : (offers.data ?? []).filter((offer) => !excludedIds.includes(offer.id));
  const options =
    selected &&
    selected.id === value &&
    !excludedIds.includes(selected.id) &&
    !results.some((offer) => offer.id === value)
      ? [selected, ...results]
      : results;
  return (
    <div className="stack-small">
      <Select<number>
        id={id}
        value={value}
        disabled={disabled}
        allowClear
        virtual={false}
        placeholder="Название или ID оффера"
        loading={waiting}
        showSearch={{
          searchValue: search,
          onSearch: (q) => setSearch(q.slice(0, 200)),
          filterOption: false,
        }}
        options={options.map((offer) => ({
          value: offer.id,
          label: `#${offer.id} · ${offer.name}`,
        }))}
        onChange={(next) => {
          setSelected(options.find((offer) => offer.id === next));
          onChange?.(next);
          setSearch("");
        }}
        notFoundContent={
          waiting ? (
            <Spin size="small" />
          ) : offers.isError ? (
            "Поиск недоступен"
          ) : (
            "Офферы не найдены"
          )
        }
        aria-label="Оффер"
      />
      {offers.isError && (
        <ErrorNotice
          error={offers.error}
          retry={() => {
            void offers.refetch();
          }}
        />
      )}
      <span className="field-hint">
        {value ? `Выбран ID ${value}. ` : ""}Только активные офферы. Поиск по
        названию или ID.
        {results.length === 20 && " Показаны первые 20 — уточните запрос."}
      </span>
    </div>
  );
}
