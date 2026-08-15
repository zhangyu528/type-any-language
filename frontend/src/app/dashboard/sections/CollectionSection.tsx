'use client';

/**
 * CollectionSection — the "收藏" partition of the console.
 *
 * Reuses /me's CollectionTab verbatim (only the wrapper differs). The
 * console now owns collection UI, so /me redirects into here. Fetches
 * the catalog locally so the tab can resolve lib names; falls back to
 * "已下架词库" if the catalog is unavailable.
 */

import { useEffect, useState } from 'react';
import { Catalog, getContentCatalog } from '../../api';
import CollectionTab from '../../me/CollectionTab';

export default function CollectionSection({ userId }: { userId: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getContentCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setCatalogError(reason instanceof Error ? reason.message : '获取内容目录失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CollectionTab userId={userId} catalog={catalog} catalogError={catalogError} />
  );
}
