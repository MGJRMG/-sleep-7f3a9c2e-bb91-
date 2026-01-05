
import { useState } from 'react';
console.log('PasswordGate geladen');
const PASSWORD = 'sleep123'; // frei wählen

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [input, setInput] = useState('');
  const [ok, setOk] = useState(false);

  if (ok) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white p-6 rounded-xl shadow max-w-sm w-full">
        <h2 className="text-lg font-bold mb-3">Geschützter Zugang</h2>
        <input
          type="password"
          placeholder="Passwort"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full border p-2 rounded mb-3"
        />
        <button
          onClick={() => input === PASSWORD && setOk(true)}
          className="w-full bg-indigo-600 text-white p-2 rounded"
        >
          Öffnen
        </button>
        {input && input !== PASSWORD && (
          <p className="text-red-500 text-sm mt-2">Falsches Passwort</p>
        )}
      </div>
    </div>
  );
}
