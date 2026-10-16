'use client';

import { Plus, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { AdminBrand, Member, adminApi } from './adminApi';
import { Button, Card, Field, PageHeader, errMsg } from './ui';

const ROLE_FA: Record<string, string> = { SUPER_ADMIN: 'مالک', ORG_ADMIN: 'مدیر', RESELLER: 'نماینده فروش' };

export function Team() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    adminApi.team().then(setMembers).catch((e) => setError(errMsg(e)));
    adminApi.brands().then(setBrands).catch(() => undefined);
  };
  useEffect(load, []);

  return (
    <div>
      <PageHeader
        title="تیم فروش"
        subtitle="به هر نماینده یک یا چند برند بسپار؛ فقط رسیدها و تنظیمات همان برندها را می‌بیند."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> نماینده جدید
          </Button>
        }
      />
      {error && <p className="mb-4 text-sm text-[#d4373f]">{error}</p>}
      {adding && (
        <NewMember
          brands={brands}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      <Card className="!p-0">
        <ul className="divide-y divide-[var(--line)]">
          {(members ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--surface-2)] text-sm font-medium">
                {(m.name || m.email).slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {m.name || m.email} {m.isYou && <span className="text-xs text-[var(--ink-3)]">(شما)</span>}
                </p>
                <p className="truncate text-xs text-[var(--ink-3)]" dir="ltr" style={{ textAlign: 'right' }}>
                  {m.email}
                </p>
              </div>
              <span className="text-xs text-[var(--ink-2)]">{ROLE_FA[m.role] ?? m.role}</span>
              {m.role === 'RESELLER' && (
                <BrandPicker
                  brands={brands}
                  value={m.brands.map((b) => b.id)}
                  onChange={(ids) =>
                    adminApi
                      .updateMember(m.id, { brandIds: ids })
                      .then(load)
                      .catch((e) => setError(errMsg(e)))
                  }
                />
              )}
              {m.role !== 'SUPER_ADMIN' && !m.isYou &&
                (confirm === m.id ? (
                  <Button
                    variant="danger"
                    onClick={() =>
                      adminApi
                        .deleteMember(m.id)
                        .then(() => {
                          setConfirm(null);
                          load();
                        })
                        .catch((e) => setError(errMsg(e)))
                    }
                  >
                    حذف «{m.name || m.email}»
                  </Button>
                ) : (
                  <Button variant="ghost" aria-label={`حذف ${m.email}`} className="!px-3" onClick={() => setConfirm(m.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function BrandPicker({ brands, value, onChange }: { brands: AdminBrand[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="برندهای نماینده">
      {brands.map((b) => {
        const on = value.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== b.id) : [...value, b.id])}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${
              on ? 'border-[var(--ink)] bg-[var(--ink)] text-white' : 'border-[var(--line)] text-[var(--ink-2)]'
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: b.primaryColor }} />
            {b.appName}
          </button>
        );
      })}
    </div>
  );
}

function NewMember({ brands, onCancel, onDone }: { brands: AdminBrand[]; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createMember({ name: name.trim(), email: email.trim(), password, role: 'RESELLER', brandIds });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="نام" htmlFor="m-name">
            <input id="m-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="ایمیل ورود" htmlFor="m-email">
            <input id="m-email" type="email" dir="ltr" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="رمز عبور" htmlFor="m-pass" hint="حداقل ۸ کاراکتر">
            <input id="m-pass" type="text" dir="ltr" minLength={8} required autoComplete="new-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
        <p className="mb-2 mt-4 text-[13px] font-medium text-[var(--ink-2)]">برندهای این نماینده</p>
        <BrandPicker brands={brands} value={brandIds} onChange={setBrandIds} />
        {error && <p className="mt-3 text-sm text-[#d4373f]">{error}</p>}
        <div className="mt-5 flex gap-2">
          <Button type="submit" busy={busy}>
            ساخت حساب نماینده
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        </div>
      </form>
    </Card>
  );
}
