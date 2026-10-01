import React, { useState, useEffect } from "react";
import { Input } from "../atoms/Input";
import { useCatalogStore } from "../../stores/useCatalogStore";

export interface SearchInputProps {
  placeholder?: string;
  debounceMs?: number;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  placeholder = "Search by product name, code, or description...",
  debounceMs = 350,
}) => {
  const searchQuery = useCatalogStore((s) => s.filters.searchQuery);
  const setSearchQuery = useCatalogStore((s) => s.setSearchQuery);
  const fetchProducts = useCatalogStore((s) => s.fetchProducts);

  const [localVal, setLocalVal] = useState(searchQuery);

  useEffect(() => {
    setLocalVal(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localVal !== searchQuery) {
        setSearchQuery(localVal);
        fetchProducts({ search: localVal, pageNo: 1 });
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [localVal, debounceMs, searchQuery, setSearchQuery, fetchProducts]);

  return (
    <Input
      placeholder={placeholder}
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onClear={() => {
        setLocalVal("");
        setSearchQuery("");
        fetchProducts({ search: "", pageNo: 1 });
      }}
      prefixIcon={<span>🔍</span>}
    />
  );
};
