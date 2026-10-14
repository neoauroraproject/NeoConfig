export default function DemoAdminPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8" dir="rtl" lang="fa">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">پنل مدیریت NeoConfig</h1>
        <span className="text-sm text-brand">اپ کاربر</span>
      </div>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">نمای کلی</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="کاربران" value="128" />
          <Stat label="سرورها" value="4" />
          <Stat label="آنلاین" value="3" />
          <Stat label="خطای همگام‌سازی" value="1" />
        </div>
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">برندینگ</h2>
        <p className="muted mt-1 text-xs">نام اپ، رنگ‌ها، لوگو و لینک پشتیبانی</p>
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
          NeoConfig
        </div>
        <button type="button" className="mt-3 rounded-2xl bg-brand px-4 py-2 text-sm text-white">
          ذخیره برندینگ
        </button>
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">پنل 3x-ui</h2>
        <p className="muted mt-1 text-xs">توکن API فقط روی سرور رمزنگاری می‌شود</p>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex items-center justify-between rounded-2xl bg-black/10 px-3 py-2">
            <span>Main panel</span>
            <span className="text-emerald-300">متصل</span>
          </li>
        </ul>
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">ایجنت سرور (نصب یک‌خطی)</h2>
        <pre className="mt-3 overflow-x-auto rounded-2xl bg-black/30 p-3 text-xs" dir="ltr">
{`curl -fsSL https://app.example.com/install.sh -o /tmp/neoconfig-install.sh && sudo bash /tmp/neoconfig-install.sh --token 'TOKEN'`}
        </pre>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/10 px-3 py-3">
      <div className="muted text-xs">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
