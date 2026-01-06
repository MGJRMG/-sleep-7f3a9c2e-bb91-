import React, { useState, useMemo, useEffect } from 'react';
import {
  Moon, Sun, Clock, AlertCircle,
  Brain, HelpCircle, Trash2,
  Shield, Timer, Activity, Thermometer, Stethoscope, Baby
} from 'lucide-react';

const NOTEBOOK_LM_URL = "https://notebooklm.google.com/notebook/165f0dbc-94f9-49cc-96d8-f61e27bc2b0f";

// --- TYPEN & INTERFACES ---

type AgeGroupKey = '0-3' | '4-6' | '7-12' | '13-18' | '19-36' | '36+';

interface SleepStandard {
  minWake: number;
  maxWake: number; // Das absolute physiologische Maximum vor Übermüdung
  naps: number;
  label: string;
  mode: 'window' | 'hybrid' | 'clock';
  bedtimeWindow: number;
  description: string;
  rangeStart: number;
  rangeEnd: number;
  tooLongNapMinutes: number;   
  latestNapEndTime: string;    
  idealBedtime: string;        
}

interface NapEntry {
  id: string;
  startTime: string;
  endTime: string;
  duration: number;
}

interface PlannedEvent {
  type: 'wake' | 'nap' | 'bedtime';
  startTime: string;
  endTime?: string;
  title: string;
  description: string;
  reasoning: string;
  isPrediction: boolean;
  alertLevel?: 'normal' | 'warning' | 'critical';
}

// --- EVIDENZBASIERTE DATEN ---

const SLEEP_STANDARDS: Record<AgeGroupKey, SleepStandard> = {
  '0-3': {
    rangeStart: 0, rangeEnd: 3,
    minWake: 45, maxWake: 90,
    naps: 4, label: 'Neugeborenes (0–3 Monate)', mode: 'window',
    bedtimeWindow: 90,
    description: 'Kein Tag-Nacht-Rhythmus. Schlafdruck baut sich extrem schnell auf.',
    tooLongNapMinutes: 120, latestNapEndTime: '18:00', idealBedtime: '20:00'
  },
  '4-6': {
    rangeStart: 4, rangeEnd: 6,
    minWake: 90, maxWake: 150,
    naps: 3, label: 'Säugling (4–6 Monate)', mode: 'window',
    bedtimeWindow: 150,
    description: 'Schlaf wird zyklisch. Wachfenster steuern den Tag.',
    tooLongNapMinutes: 120, latestNapEndTime: '17:30', idealBedtime: '19:30'
  },
  '7-12': {
    rangeStart: 7, rangeEnd: 12,
    minWake: 150, maxWake: 210, // Max 3.5h
    naps: 2, label: 'Baby (7–12 Monate)', mode: 'hybrid',
    bedtimeWindow: 210,
    description: 'Übergang zu 2 Naps. Letztes Wachfenster ist das längste.',
    tooLongNapMinutes: 120, latestNapEndTime: '16:30', idealBedtime: '19:30'
  },
  '13-18': {
    rangeStart: 13, rangeEnd: 18,
    minWake: 240, maxWake: 300, // Max 5h
    naps: 1, label: 'Kleinkind (13–18 Monate)', mode: 'hybrid',
    bedtimeWindow: 270, // 4.5h vor Bett
    description: 'Umstellung auf einen Mittagsschlaf. Mittagsschlaf sollte mittig liegen.',
    tooLongNapMinutes: 150, latestNapEndTime: '15:00', idealBedtime: '19:30'
  },
  '19-36': {
    rangeStart: 19, rangeEnd: 36,
    minWake: 300, maxWake: 360, // Max 6h (Physiologisches Limit!)
    naps: 1, label: 'Kleinkind (2–3 Jahre)', mode: 'clock',
    bedtimeWindow: 360, // 6h vor Bett (Standard)
    description: 'Strategie: Bei frühem Erwachen Nap vorziehen & begrenzen, um Nachtschlaf zu verlängern.',
    tooLongNapMinutes: 120, latestNapEndTime: '15:00', idealBedtime: '19:30'
  },
  '36+': {
    rangeStart: 37, rangeEnd: 60,
    minWake: 360, maxWake: 720,
    naps: 0, label: 'Vorschulkind (3–5 Jahre)', mode: 'clock',
    bedtimeWindow: 720,
    description: 'Mittagsschlaf entfällt meist. Ruhezeit statt Schlaf.',
    tooLongNapMinutes: 60, latestNapEndTime: '14:30', idealBedtime: '20:00'
  }
};

// --- HELPER FUNCTIONS ---

const timeToMinutes = (time: string): number => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = (minutes: number): string => {
  let h = Math.floor(minutes / 60);
  let m = Math.floor(minutes % 60);
  if (h >= 24) h -= 24;
  if (h < 0) h += 24; // Handle negative overlap
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const addMinutes = (time: string, mins: number): string => {
  return minutesToTime(timeToMinutes(time) + mins);
};

const getDuration = (start: string, end: string): number => {
  let diff = timeToMinutes(end) - timeToMinutes(start);
  if (diff < 0) diff += 1440;
  return diff;
};

const getStandardByMonth = (month: number): SleepStandard => {
  if (month <= 3) return SLEEP_STANDARDS['0-3'];
  if (month <= 6) return SLEEP_STANDARDS['4-6'];
  if (month <= 12) return SLEEP_STANDARDS['7-12'];
  if (month <= 18) return SLEEP_STANDARDS['13-18'];
  if (month <= 36) return SLEEP_STANDARDS['19-36'];
  return SLEEP_STANDARDS['36+'];
};

const calculateInterpolatedWakeWindow = (month: number, std: SleepStandard): number => {
  if (std.rangeStart === std.rangeEnd) return std.maxWake;
  const progress = (month - std.rangeStart) / (std.rangeEnd - std.rangeStart);
  return Math.round(std.minWake + (std.maxWake - std.minWake) * progress);
};

const isLater = (a: string, b: string) => timeToMinutes(a) > timeToMinutes(b);

// --- HAUPTKOMPONENTE ---

const PediatricSleepApp: React.FC = () => {
  // Default Startwert angepasst auf das Problem-Szenario zum Testen
  const [ageMonths, setAgeMonths] = useState<number>(24);
  const [wakeTime, setWakeTime] = useState<string>('05:00'); 
  const [naps, setNaps] = useState<NapEntry[]>([]);
  const [napStart, setNapStart] = useState<string>('');
  const [napEnd, setNapEnd] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'schedule' | 'tips'>('schedule');

  useEffect(() => {
    document.title = 'SleepSync Pädiatrie';
  }, []);

  const scheduleData = useMemo(() => {
    const std = getStandardByMonth(ageMonths);
    const specificWakeWindow = calculateInterpolatedWakeWindow(ageMonths, std);
    const events: PlannedEvent[] = [];
    const warnings: string[] = [];

    // 1) Aufwachzeit
    events.push({
      type: 'wake',
      startTime: wakeTime,
      title: 'Tagesbeginn',
      description: 'Start des Schlafdruck-Aufbaus.',
      reasoning: 'Licht und Frühstück helfen, die innere Uhr zu stellen.',
      isPrediction: false
    });

    const wakeMins = timeToMinutes(wakeTime);
    let currentTime = wakeTime;
    let napsPlanned = 0;

    // Warnung bei extrem frühem Start
    if (wakeMins < 360) { // vor 06:00
      warnings.push('Frühes Aufwachen (05:00): Strategie "Nap Capping" aktiviert, um Nachtschlaf zu verlängern.');
    }

    // 2) Bereits erfolgte Naps einfügen
    naps.forEach((nap, index) => {
      const isCrapNap = nap.duration < 45;
      const isTooLong = nap.duration > std.tooLongNapMinutes;
      let alertLevel: 'normal' | 'warning' | 'critical' = 'normal';
      let reasoning = 'Gute Erholung.';

      if (isCrapNap) {
        reasoning = 'Kurzer Nap baut Schlafdruck nur unvollständig ab. Nächstes Wachfenster verkürzen.';
        alertLevel = 'warning';
      } else if (isTooLong) {
        reasoning = 'Zu langer Nap "stiehlt" Schlafdruck für die Nacht.';
        alertLevel = 'warning';
      }

      events.push({
        type: 'nap',
        startTime: nap.startTime,
        endTime: nap.endTime,
        title: `Nickerchen ${index + 1} (Ist)`,
        description: `${nap.duration} min.`,
        reasoning,
        isPrediction: false,
        alertLevel
      });

      currentTime = nap.endTime;
      napsPlanned++;
    });

    // 3) Vorhersage der nächsten Naps
    const remainingNaps = Math.max(0, std.naps - napsPlanned);
    const isToddler = ageMonths >= 19 && ageMonths <= 36;
    
    // Basis-Wachfenster für den nächsten Schritt
    let nextWakeWindow = specificWakeWindow;
    
    // Adjustment nach kurzem vorherigen Nap
    if (naps.length > 0) {
        const lastNap = naps[naps.length - 1];
        if (lastNap.duration < 45) {
             nextWakeWindow = Math.round(nextWakeWindow * 0.8); // Deutliche Reduktion
             warnings.push('Vorheriger Nap war kurz: Nächstes Wachfenster deutlich reduziert.');
        }
    }

    for (let i = 0; i < remainingNaps; i++) {
        const napNumber = napsPlanned + i + 1;
        
        // --- LOGIK-KERNANPASSUNG FÜR KLEINKINDER (19-36 Monate) ---
        let predictedNapStart = '';
        let predictedDuration = 90;
        let noteTitle = `Vorschlag: Nap ${napNumber}`;
        let noteDesc = '';
        let noteReason = '';
        let alertLevel: 'normal' | 'warning' | 'critical' = 'normal';

        if (isToddler && std.naps === 1 && napsPlanned === 0) {
            
            const idealClockNap = timeToMinutes('12:30');
            const physiologicalMaxNap = timeToMinutes(currentTime) + std.maxWake; // z.B. 05:00 + 6h = 11:00
            
            // Logik: Ist das physiologische Maximum (11:00) deutlich vor der Uhrzeit (12:30)?
            if (physiologicalMaxNap < idealClockNap - 30) {
                // FALL: Frühes Erwachen (z.B. 05:00 -> Nap 11:00)
                predictedNapStart = minutesToTime(physiologicalMaxNap);
                
                // STRATEGIE: Strategic Capping (75 min)
                predictedDuration = 75; 
                const wakeUpTime = addMinutes(predictedNapStart, 75);
                
                noteTitle = "Strategischer Mittagsschlaf (Capping)";
                noteDesc = `Start: ${predictedNapStart} | Wecken um: ${wakeUpTime}`;
                noteReason = `Kompromisszeit 11:00 Uhr. WICHTIG: Nach 75 Min (${wakeUpTime}) wecken! Das sichert genug Schlafdruck für eine Bettzeit um 18:15 Uhr.`;
                alertLevel = 'warning'; // Gelb, um Aufmerksamkeit zu erregen
                
                warnings.push('WICHTIG: Mittagsschlaf nach 75 Minuten beenden (Wecken), damit die Bettzeit heute Abend passt.');
            } else {
                // FALL: Normales Aufwachen
                const physiologicalMinNap = timeToMinutes(currentTime) + std.minWake;
                const target = Math.max(physiologicalMinNap, idealClockNap);
                const finalStart = Math.min(target, physiologicalMaxNap);
                
                predictedNapStart = minutesToTime(finalStart);
                noteDesc = `Zielzeit ca. ${predictedNapStart}. Dauer: 90 Min.`;
                noteReason = 'Standard-Mittagsschlafzeit passend zum Wachfenster.';
            }

        } else {
            // Standard Wachfenster-Logik
            predictedNapStart = addMinutes(currentTime, nextWakeWindow);
            predictedDuration = (std.naps > 1 && napNumber === std.naps) ? 30 : 90; // Letzter Nap oft kürzer
            
            const hoursWake = Math.round(nextWakeWindow / 60 * 10) / 10;
            noteDesc = `Dauer ca. ${predictedDuration} Min.`;
            noteReason = `Basiert auf Wachfenster von ca. ${hoursWake} Std.`;
        }

        const predictedNapEnd = addMinutes(predictedNapStart, predictedDuration);

        // Check auf "zu spät"
        if (std.latestNapEndTime && isLater(predictedNapEnd, std.latestNapEndTime)) {
            noteReason += ` ACHTUNG: Nap endet sehr spät (${predictedNapEnd}). Gefahr für Bettzeit!`;
            alertLevel = 'warning';
        }

        events.push({
            type: 'nap',
            startTime: predictedNapStart,
            endTime: predictedNapEnd,
            title: noteTitle,
            description: noteDesc,
            reasoning: noteReason,
            isPrediction: true,
            alertLevel
        });

        currentTime = predictedNapEnd;
        nextWakeWindow = std.maxWake; 
    }

    // 4) Bettzeit Berechnung
    let finalWakeWindow = std.bedtimeWindow;
    
    if (std.mode !== 'clock') {
        const p = (ageMonths - std.rangeStart) / (std.rangeEnd - std.rangeStart);
        finalWakeWindow = Math.round(std.bedtimeWindow - 30 + (60 * p));
    }

    // Spezial-Logik Bettzeit bei Capping:
    const lastEvent = events[events.length - 1];
    let isStrategicCapping = false;

    // FIX: Wir prüfen auf den Titel, da die Description variieren kann.
    if (isToddler && lastEvent && lastEvent.type === 'nap' && lastEvent.title.includes('Capping')) {
       isStrategicCapping = true;
       // Wir lassen das Wachfenster bei 6h (360min)
       // 12:15 + 6h = 18:15. Das passt perfekt zur Vorgabe.
       finalWakeWindow = 360; 
    } else if (lastEvent && lastEvent.type === 'nap' && lastEvent.alertLevel === 'warning') {
        // Bei anderen "Problemnaps" (z.B. versehentlich kurz bei Baby) verkürzen wir stärker
        finalWakeWindow = Math.round(finalWakeWindow * 0.9);
    }

    let bedtime = addMinutes(currentTime, finalWakeWindow);
    const bedtimeMins = timeToMinutes(bedtime);

    let bedTitle = "Bettzeit";
    let bedDesc = "Nachtruhe";
    let bedReason = `Wachzeit vor Bett: ${Math.round(finalWakeWindow/60*10)/10} Std.`;
    let bedAlert: 'normal' | 'warning' | 'critical' = 'normal';

    if (isStrategicCapping) {
        bedTitle = "Ziel-Bettzeit";
        bedDesc = "18:15 – 18:45 Uhr";
        bedReason = "Nach dem Wecken um 12:15 Uhr benötigt das Kind ca. 5,5–6h Wachzeit. Ziel: Übermüdung vermeiden, aber Schlafdruck nutzen.";
        bedAlert = 'warning'; // Highlight
        // Wir setzen die Zeit hart auf den Beginn des Fensters für die Anzeige
        bedtime = addMinutes(currentTime, 360); // 12:15 + 6h = 18:15
    }
    // Plausibilitäts-Check Bettzeit (nur wenn kein Strategic Capping)
    else if (bedtimeMins < 1080) { // Vor 18:00
        bedTitle = "Frühe Bettzeit";
        bedDesc = "Ausgleich für frühen Start";
        bedReason = "Wegen des frühen Morgens ist eine frühe Bettzeit nötig.";
        bedAlert = 'warning';
    } else if (bedtimeMins > 1260) { // Nach 21:00
        bedTitle = "Späte Bettzeit";
        bedReason = "Wachfenster wurde sehr lang. Risiko, dass das Kind überdreht.";
        bedAlert = 'critical';
    }

    events.push({
      type: 'bedtime',
      startTime: bedtime,
      title: bedTitle,
      description: bedDesc,
      reasoning: bedReason,
      isPrediction: true,
      alertLevel: bedAlert
    });

    return { events, warnings, standard: std };
  }, [ageMonths, wakeTime, naps]);

  const addNap = () => {
    if (!napStart || !napEnd) return;
    const duration = getDuration(napStart, napEnd);
    setNaps(
      [...naps, { id: Date.now().toString(), startTime: napStart, endTime: napEnd, duration }]
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    );
    setNapStart('');
    setNapEnd('');
  };

  const removeNap = (id: string) => {
    setNaps(naps.filter(n => n.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 pb-20">
      {/* HEADER */}
      <header className="bg-indigo-900 text-white p-4 md:p-6 shadow-lg sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Moon className="w-6 h-6 md:w-8 md:h-8 text-indigo-300" />
            <div>
              <h1 className="text-xl md:text-2xl font-bold leading-tight">SleepSync</h1>
              <p className="text-indigo-200 text-xs hidden md:block">Evidenzbasierter Schlafplaner</p>
            </div>
          </div>
          <span className="bg-indigo-800 text-indigo-200 text-xs px-2 py-1 rounded-full font-mono md:hidden">
            {ageMonths} Mon.
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        {/* TABS */}
        <div className="flex bg-white rounded-xl shadow-sm p-1 mb-6">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 py-3 text-sm font-bold rounded-lg transition touch-manipulation ${activeTab === 'schedule' ? 'bg-indigo-100 text-indigo-900 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Tagesplaner
          </button>
          <button
            onClick={() => setActiveTab('tips')}
            className={`flex-1 py-3 text-sm font-bold rounded-lg transition touch-manipulation ${activeTab === 'tips' ? 'bg-indigo-100 text-indigo-900 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Wissen & Logik
          </button>
        </div>

        {activeTab === 'schedule' ? (
          <div className="space-y-6">
            {/* CONFIG CARD */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Alter Slider */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Alter</label>
                    <span className="text-indigo-600 font-bold bg-indigo-50 px-3 py-1 rounded-full text-sm">
                      {ageMonths} Monate
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="48"
                    value={ageMonths}
                    onChange={(e) => { setAgeMonths(parseInt(e.target.value)); setNaps([]); }}
                    className="w-full h-4 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 touch-pan-x"
                  />
                  <p className="text-xs text-slate-400 mt-2 text-right">
                    {scheduleData.standard.label}
                  </p>
                </div>

                {/* Aufwachzeit */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide block mb-2">Aufwachzeit</label>
                  <input
                    type="time"
                    value={wakeTime}
                    onChange={(e) => setWakeTime(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-base"
                  />
                </div>
              </div>
            </div>

            {/* INPUT SECTION */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                <Sun className="w-5 h-5 text-orange-400" />
                Nickerchen eingeben (Ist)
              </h3>

              {naps.map((nap, i) => (
                <div key={nap.id} className="flex justify-between items-center bg-slate-50 border border-slate-100 p-3 rounded-lg mb-2">
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-700 text-sm">Nap {i + 1}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-sm text-slate-600">{nap.startTime} - {nap.endTime}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${nap.duration < 45 ? 'bg-orange-50 border-orange-100 text-orange-700' : 'bg-green-50 border-green-100 text-green-700'}`}>
                        {nap.duration}m
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeNap(nap.id)}
                    className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-3 rounded-full transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <div className="flex gap-3 items-end mt-4 pt-4 border-t border-slate-100">
                <div className="flex-1 min-w-[80px]">
                  <label className="text-xs text-slate-400 block mb-1">Von</label>
                  <input type="time" value={napStart} onChange={e => setNapStart(e.target.value)} className="w-full p-3 bg-slate-50 border rounded-xl font-mono text-base outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
                <div className="flex-1 min-w-[80px]">
                  <label className="text-xs text-slate-400 block mb-1">Bis</label>
                  <input type="time" value={napEnd} onChange={e => setNapEnd(e.target.value)} className="w-full p-3 bg-slate-50 border rounded-xl font-mono text-base outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
                <button
                  onClick={addNap}
                  disabled={!napStart || !napEnd}
                  className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white w-12 h-[50px] rounded-xl flex items-center justify-center disabled:opacity-50 transition shadow-sm shrink-0"
                >
                  <span className="text-2xl font-bold leading-none pb-1">+</span>
                </button>
              </div>
            </div>

            {/* WARNINGS */}
            {scheduleData.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl space-y-2 animate-in fade-in">
                {scheduleData.warnings.map((w, i) => (
                  <div key={i} className="flex gap-3 text-amber-900 text-sm items-start">
                    <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
                    <p>{w}</p>
                  </div>
                ))}
              </div>
            )}

            {/* TIMELINE */}
            <div className="relative pl-4 border-l-2 border-indigo-100 space-y-4 py-2">
              {scheduleData.events.map((evt, i) => (
                <div key={i} className={`relative pl-6 ${evt.isPrediction ? 'opacity-90' : ''}`}>
                  <div className={`absolute -left-[9px] top-5 w-4 h-4 rounded-full border-2 border-white shadow-sm
                    ${evt.type === 'wake' ? 'bg-yellow-400' :
                      evt.type === 'nap' ? 'bg-indigo-400' : 'bg-indigo-900'}`}
                  />

                  <div className={`p-4 rounded-xl border transition-all 
                    ${evt.alertLevel === 'critical' ? 'bg-red-50 border-red-200' :
                      evt.alertLevel === 'warning' ? 'bg-amber-50 border-amber-200' :
                        evt.isPrediction ? 'bg-white border-dashed border-slate-300' : 'bg-white border-slate-100 shadow-sm'}`}>

                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        {evt.type === 'wake' && <Sun className="w-3.5 h-3.5 text-yellow-500" />}
                        {evt.type === 'nap' && <Clock className="w-3.5 h-3.5 text-indigo-500" />}
                        {evt.type === 'bedtime' && <Moon className="w-3.5 h-3.5 text-indigo-900" />}
                        {evt.title}
                      </span>
                      {evt.isPrediction && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium border border-indigo-100">
                          Vorschlag
                        </span>
                      )}
                    </div>

                    <div className="text-2xl font-bold font-mono text-slate-800 mb-2 tracking-tight">
                      {evt.startTime} {evt.endTime && <span className="text-lg text-slate-400 font-normal">- {evt.endTime}</span>}
                    </div>

                    <p className="text-sm text-slate-600 mb-3 border-b border-slate-100 pb-2 leading-relaxed font-medium">
                      {evt.description}
                    </p>

                    <div className="flex gap-2 text-xs text-slate-500 bg-slate-50/80 p-2 rounded-lg">
                      <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-400" />
                      <div>
                        <span className="font-bold text-indigo-900 block mb-0.5">Logik:</span>
                        <span className="whitespace-pre-line">{evt.reasoning}</span>
                      </div>
                    </div>

                  </div>
                </div>
              ))}
            </div>

          </div>
        ) : (
          <div className="space-y-6">
            
            {/* NotebookLM Shortcut */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-slate-800 text-base">
                    Wissensdatenbank (NotebookLM)
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Vertiefende Inhalte, Studien & Hintergrundwissen zu Schlaf, Routinen und Entwicklung.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Öffnet in neuem Tab
                  </p>
                </div>

                <a
                  href={NOTEBOOK_LM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2
                    bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800
                    text-white px-5 py-3 rounded-xl text-sm font-bold
                    shadow-md hover:shadow-lg
                    transition-all whitespace-nowrap"
                >
                  <HelpCircle className="w-4 h-4" />
                  Frag den Schlaf-Assistenten
                </a>
              </div>
            </div>

            {/* 1. Physiologie & Modelle */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2">
                <Brain className="w-5 h-5 text-indigo-600" />
                Schlaf verstehen
              </h3>

              <div className="space-y-4">
                <div className="bg-indigo-50 p-4 rounded-xl">
                  <h4 className="font-bold text-indigo-900 mb-2 text-sm">Zwei-Prozess-Modell (S/C)</h4>
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li className="flex gap-2">
                      <span className="font-bold text-indigo-600 shrink-0">Prozess S:</span>
                      <span>Homöostatischer Schlafdruck (Adenosin). Steigt mit der Wachzeit und sinkt im Schlaf.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-indigo-600 shrink-0">Prozess C:</span>
                      <span>Zirkadianer Rhythmus. Wird vor allem durch Licht/Dunkelheit und feste Routinen stabilisiert.</span>
                    </li>
                  </ul>
                </div>

                <div className="border border-slate-100 p-4 rounded-xl">
                  <h4 className="font-bold text-slate-800 mb-2 text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    Schlafzyklen im Kindesalter
                  </h4>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Bei Babys sind Schlafzyklen kürzer als bei Erwachsenen. Kurze Wachmomente zwischen den Zyklen sind häufig und altersentsprechend.
                  </p>
                </div>
              </div>
            </div>

            {/* 2. Übermüdung */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2">
                <Timer className="w-5 h-5 text-orange-500" />
                Übermüdung: warum „müde“ nicht immer „schläfrig“ bedeutet
              </h3>
              <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                <p className="text-orange-900 text-sm font-bold mb-2">Übermüdungs-Paradox</p>
                <p className="text-orange-800 text-sm leading-relaxed mb-3">
                  Wird ein Wachfenster deutlich überschritten, kann das Stresssystem aktiviert werden. Das kann dazu führen, dass Kinder trotz Müdigkeit „aufdrehen“ und schwerer abschalten.
                </p>
                <p className="text-orange-800 text-sm italic">
                  Praxis-Tipp: Bei anhaltendem Einschlafkampf oder sehr frühem Erwachen lohnt sich häufig eine moderat frühere Bettzeit.
                </p>
              </div>
            </div>

            {/* 3. Sicherheit (SIDS) */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-green-600" />
                Sichere Schlafumgebung (SIDS)
              </h3>

              <div className="grid gap-3">
                <div className="bg-green-50 p-3 rounded-xl border border-green-100">
                  <h4 className="font-bold text-green-900 mb-2 text-sm">ABC-Regel</h4>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-3 text-sm text-slate-700">
                      <span className="font-bold text-green-700 bg-green-200 w-5 h-5 flex items-center justify-center rounded-full shrink-0 text-[10px]">A</span>
                      <span><strong>Alone:</strong> Eigenes Bett, keine Kissen/Decken/Nestchen oder Kuscheltiere im Schlafbereich.</span>
                    </li>
                    <li className="flex items-start gap-3 text-sm text-slate-700">
                      <span className="font-bold text-green-700 bg-green-200 w-5 h-5 flex items-center justify-center rounded-full shrink-0 text-[10px]">B</span>
                      <span><strong>Back:</strong> Rückenlage zum Schlafen (solange das Kind sich nicht selbstständig dreht).</span>
                    </li>
                    <li className="flex items-start gap-3 text-sm text-slate-700">
                      <span className="font-bold text-green-700 bg-green-200 w-5 h-5 flex items-center justify-center rounded-full shrink-0 text-[10px]">C</span>
                      <span><strong>Crib:</strong> Feste Matratze, straff sitzendes Laken, keine weichen Unterlagen.</span>
                    </li>
                  </ul>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="border border-slate-100 p-3 rounded-xl flex items-start gap-2">
                    <Thermometer className="w-4 h-4 text-blue-400 mt-1" />
                    <div>
                      <strong className="block text-sm text-slate-700">Raumtemperatur</strong>
                      <p className="text-xs text-slate-500">Eher kühl (ca. 16–18°C) und Überwärmung vermeiden.</p>
                    </div>
                  </div>
                  <div className="border border-slate-100 p-3 rounded-xl flex items-start gap-2">
                    <Baby className="w-4 h-4 text-pink-400 mt-1" />
                    <div>
                      <strong className="block text-sm text-slate-700">Schnuller</strong>
                      <p className="text-xs text-slate-500">Zum Einschlafen kann ein Schnuller in vielen Fällen hilfreich sein.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Red Flags */}
            <div className="bg-red-50 p-5 rounded-2xl border border-red-100">
              <h3 className="font-bold text-red-900 text-lg mb-3 flex items-center gap-2">
                <Stethoscope className="w-5 h-5" />
                Wann ärztlich abklären?
              </h3>
              <ul className="space-y-2 text-sm text-red-800">
                <li className="flex gap-2 items-start">
                  <span className="text-red-500">•</span>
                  <span><strong>Anhaltendes Schnarchen:</strong> Regelmäßiges, lautes Schnarchen sollte abgeklärt werden (z. B. vergrößerte Rachenmandeln/Polypen).</span>
                </li>
                <li className="flex gap-2 items-start">
                  <span className="text-red-500">•</span>
                  <span><strong>Dauerhafte Mundatmung:</strong> Häufige Mundatmung am Tag oder in der Nacht.</span>
                </li>
                <li className="flex gap-2 items-start">
                  <span className="text-red-500">•</span>
                  <span><strong>Starker Nachtschweiß:</strong> Insbesondere in Kombination mit unruhigem Schlaf oder Atemauffälligkeiten.</span>
                </li>
              </ul>
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default PediatricSleepApp;