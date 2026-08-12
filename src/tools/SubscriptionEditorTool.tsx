import { useCallback, useEffect, useRef, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import { CreditCard, Save, X } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { StatusMessage, ToolbarButton } from './systemToolUtils';
import { useToolDataStore } from '../stores/toolDataStore';
import {
  CURRENCIES,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  EDITOR_REQUEST_KEY,
  EMPTY_ITEM,
  SUBSCRIPTION_MANAGER_VERSION,
  clampNumber,
  toDateInput,
  uid,
  type SubscriptionManagerToolData,
  type BillingCycle,
  type SubscriptionCategory,
  type SubscriptionItem,
  type SubscriptionSettings,
  type SubscriptionStatus,
} from './subscriptionManagerStore';

interface EditorRequest {
  mode?: 'create' | 'edit';
  id?: string;
  nonce?: number;
}

const TODAY = new Date();

function readEditorRequest(): EditorRequest {
  try {
    return JSON.parse(window.localStorage.getItem(EDITOR_REQUEST_KEY) || '{}') as EditorRequest;
  } catch {
    return {};
  }
}

function createEmptyItem(categories: SubscriptionCategory[]) {
  return {
    ...EMPTY_ITEM,
    id: uid(),
    categoryId: categories[0]?.id || EMPTY_ITEM.categoryId,
    nextPaymentDate: toDateInput(TODAY),
    startDate: toDateInput(TODAY),
  };
}

export default function SubscriptionEditorTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateSubscriptionManagerData } = useToolDataStore();
  const storeData = data.subscriptionManager;
  const lastNonceRef = useRef<number | undefined>();
  const [categories, setCategories] = useState<SubscriptionCategory[]>(DEFAULT_CATEGORIES);
  const [settings, setSettings] = useState<SubscriptionSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<SubscriptionItem>(() => createEmptyItem(DEFAULT_CATEGORIES));
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [message, setMessage] = useState('填写后保存到本机订阅库。');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loadData, loaded]);

  const loadEditor = useCallback(
    (force = false) => {
      if (!loaded) return;
      const store = {
        items: storeData?.items || [],
        categories: storeData?.categories?.length ? storeData.categories : DEFAULT_CATEGORIES,
        settings: storeData?.settings || DEFAULT_SETTINGS,
      };
      const request = readEditorRequest();
      if (!force && request.nonce && request.nonce === lastNonceRef.current) return;
      lastNonceRef.current = request.nonce;

      const nextCategories = store.categories.length ? store.categories : DEFAULT_CATEGORIES;
      setCategories(nextCategories);
      setSettings(store.settings);

      if (request.mode === 'edit' && request.id) {
        const existing = store.items.find((item) => item.id === request.id);
        if (existing) {
          setMode('edit');
          setDraft({ ...existing });
          setMessage(`正在编辑 ${existing.name}`);
          setError('');
          return;
        }
        setError('没有找到要编辑的订阅，已切换为新增。');
      }

      setMode('create');
      setDraft(createEmptyItem(nextCategories));
      setMessage('正在新增订阅');
    },
    [loaded, storeData]
  );

  useEffect(() => {
    loadEditor(true);
    const onFocus = () => loadEditor();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === EDITOR_REQUEST_KEY) loadEditor();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [loadEditor]);

  const updateDraft = <K extends keyof SubscriptionItem>(key: K, value: SubscriptionItem[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const closeWindow = () => {
    void appWindow.close();
  };

  const saveDraft = async () => {
    setError('');
    const name = draft.name.trim();
    if (!name) {
      setError('订阅名称不能为空');
      return;
    }
    if (draft.amount <= 0) {
      setError('订阅金额必须大于 0');
      return;
    }

    const next: SubscriptionItem = {
      ...draft,
      id: draft.id || uid(),
      name,
      amount: clampNumber(draft.amount),
      customDays: Math.max(1, Math.round(draft.customDays || 30)),
      reminderDays: Math.max(0, Math.round(draft.reminderDays || 0)),
      cancellationDays: Math.max(0, Math.round(draft.cancellationDays || 0)),
      logoText: draft.logoText.trim() || name.slice(0, 2),
    };
    const latestStore = {
      items: storeData?.items || [],
      categories: storeData?.categories?.length ? storeData.categories : categories,
      settings: storeData?.settings || settings,
    };
    const sourceItems = latestStore.items;
    if (mode === 'edit' && !sourceItems.some((item) => item.id === next.id)) {
      setError('该订阅已被删除，请关闭窗口后重新打开。');
      return;
    }
    const nextCategories = latestStore.categories.length ? latestStore.categories : categories;
    const nextSettings = latestStore.settings || settings;
    const nextItems = sourceItems.some((item) => item.id === next.id)
      ? sourceItems.map((item) => (item.id === next.id ? next : item))
      : [next, ...sourceItems];

    const nextStore: Omit<SubscriptionManagerToolData, 'lastModified'> = {
      version: SUBSCRIPTION_MANAGER_VERSION,
      items: nextItems,
      categories: nextCategories,
      settings: nextSettings,
    };
    await updateSubscriptionManagerData(nextStore);
    setCategories(nextCategories);
    setSettings(nextSettings);
    setDraft(next);
    setMessage(`已保存 ${next.name}`);
    void emit('subscription-manager-updated', { id: next.id }).finally(closeWindow);
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="📆"
        title={mode === 'edit' ? '编辑订阅' : '新增订阅'}
        subtitle="订阅名称、扣费周期、提醒窗口和付款信息"
        actions={
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={() => void saveDraft()}>
              <Save size={14} />
              保存
            </ToolbarButton>
            <ToolbarButton onClick={closeWindow}>
              <X size={14} />
              关闭
            </ToolbarButton>
          </div>
        }
      />

      <main className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <StatusMessage message={message} error={error} />
          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CreditCard size={15} />
              订阅信息
            </div>
            <div className="mt-4 grid gap-3 text-sm">
              <Field label="名称">
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft('name', event.target.value)}
                  className="field"
                  placeholder="例如 Netflix、iCloud、ChatGPT"
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="金额">
                  <input
                    type="number"
                    min={0}
                    value={draft.amount}
                    onChange={(event) => updateDraft('amount', Number(event.target.value))}
                    className="field"
                  />
                </Field>
                <Field label="币种">
                  <select
                    value={draft.currency}
                    onChange={(event) => updateDraft('currency', event.target.value)}
                    className="field"
                  >
                    {CURRENCIES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="周期">
                  <select
                    value={draft.billingCycle}
                    onChange={(event) =>
                      updateDraft('billingCycle', event.target.value as BillingCycle)
                    }
                    className="field"
                  >
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                    <option value="quarterly">每季度</option>
                    <option value="yearly">每年</option>
                    <option value="custom">自定义天数</option>
                  </select>
                </Field>
                <Field label="自定义天数">
                  <input
                    type="number"
                    min={1}
                    value={draft.customDays}
                    onChange={(event) => updateDraft('customDays', Number(event.target.value))}
                    className="field"
                    disabled={draft.billingCycle !== 'custom'}
                  />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="下次扣款">
                  <input
                    type="date"
                    value={draft.nextPaymentDate}
                    onChange={(event) => updateDraft('nextPaymentDate', event.target.value)}
                    className="field"
                  />
                </Field>
                <Field label="开始日期">
                  <input
                    type="date"
                    value={draft.startDate}
                    onChange={(event) => updateDraft('startDate', event.target.value)}
                    className="field"
                  />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="分类">
                  <select
                    value={draft.categoryId}
                    onChange={(event) => updateDraft('categoryId', event.target.value)}
                    className="field"
                  >
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="状态">
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      updateDraft('status', event.target.value as SubscriptionStatus)
                    }
                    className="field"
                  >
                    <option value="active">启用</option>
                    <option value="paused">暂停</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="扣款提醒天数">
                  <input
                    type="number"
                    min={0}
                    value={draft.reminderDays}
                    onChange={(event) => updateDraft('reminderDays', Number(event.target.value))}
                    className="field"
                  />
                </Field>
                <Field label="取消提醒天数">
                  <input
                    type="number"
                    min={0}
                    value={draft.cancellationDays}
                    onChange={(event) =>
                      updateDraft('cancellationDays', Number(event.target.value))
                    }
                    className="field"
                  />
                </Field>
              </div>
              <Field label="付款方式">
                <input
                  value={draft.paymentMethod}
                  onChange={(event) => updateDraft('paymentMethod', event.target.value)}
                  className="field"
                  placeholder="银行卡、支付宝、微信、PayPal..."
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="成员/用途">
                  <input
                    value={draft.owner}
                    onChange={(event) => updateDraft('owner', event.target.value)}
                    className="field"
                  />
                </Field>
                <Field label="标识">
                  <input
                    value={draft.logoText}
                    onChange={(event) => updateDraft('logoText', event.target.value)}
                    className="field"
                    maxLength={4}
                  />
                </Field>
              </div>
              <Field label="官网/管理地址">
                <input
                  value={draft.website}
                  onChange={(event) => updateDraft('website', event.target.value)}
                  className="field"
                />
              </Field>
              <Field label="备注">
                <textarea
                  value={draft.notes}
                  onChange={(event) => updateDraft('notes', event.target.value)}
                  className="field min-h-24 resize-none"
                />
              </Field>
            </div>
          </section>
        </div>
      </main>

      <style>{`
        .field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(229 231 235);
          background: transparent;
          padding: 0.5rem 0.75rem;
          outline: none;
        }
        .field:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .dark .field {
          border-color: rgb(55 65 81);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-gray-500">
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
