import { ChunkyButton } from './ui/ChunkyButton';

/** App shell. Placeholder screen until the real screens arrive. */
export function App() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <main className="flex flex-1 flex-col px-[18px] pt-[22px]">
        <h1 className="mt-2.5 mb-1 text-[30px] font-black leading-[1.1]">Werkplekinspectie</h1>
        <p className="text-sub">De app wordt nog gebouwd.</p>
      </main>
      <footer className="px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">
        <ChunkyButton disabled>Start inspectie</ChunkyButton>
      </footer>
    </div>
  );
}
