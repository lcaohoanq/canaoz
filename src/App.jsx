import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp,
  Clock3, GraduationCap, Heart, Instagram, LoaderCircle, Search,
  Sparkles, UserRound, UsersRound, X,
} from 'lucide-react';
import { classifyQuery, filterRecords } from './lib/search';
import { demoPeople } from './data/demo';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || (import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE !== 'false');
const FORM_URL = (import.meta.env.VITE_FORM_URL || '').trim();
const CORRECTION_URL = (import.meta.env.VITE_CORRECTION_URL || '').trim();

const shifts = [
  { id: 1, caption: 'BUỔI SÁNG', emoji: '🌤️', checkin: '6:00 – 6:50', ceremony: '7:00 – 9:30', mood: 'Ngủ dậy sớm vì tấm bằng' },
  { id: 2, caption: 'BUỔI TRƯA', emoji: '☀️', checkin: '9:00 – 9:50', ceremony: '10:00 – 12:30', mood: 'Tốt nghiệp giữa giờ ăn trưa' },
  { id: 3, caption: 'BUỔI CHIỀU', emoji: '🌇', checkin: '13:00 – 13:50', ceremony: '14:00 – 16:30', mood: 'Ca này đã có lịch nè!' },
];

function getInitials(name) {
  return name.trim().split(/\s+/).slice(-2).map((item) => item[0]).join('').toUpperCase();
}

function ShiftTag({ shift }) {
  return <span className={`shift-tag shift-tag-${shift}`}>Ca {String(shift).padStart(2, '0')}</span>;
}

function SearchHint({ query }) {
  const parsed = classifyQuery(query);
  if (parsed.kind === 'empty') return <span>Thử: <strong>Nguyễn Minh Anh</strong> hoặc <strong>AB123456</strong></span>;
  if (parsed.kind === 'id') return <span className="text-emerald-700 flex items-center gap-1.5"><Check size={13} /> MSSV hợp lệ · tìm chính xác</span>;
  if (parsed.kind === 'invalid-id') return <span className="text-red-600">MSSV cần đúng định dạng: 2 chữ cái + 6 chữ số.</span>;
  if (parsed.kind === 'short-name') return <span>Nhập ít nhất 2 ký tự để tìm tên nha 👀</span>;
  return <span>Tìm theo tên · không phân biệt dấu và chữ hoa/thường</span>;
}

function StudentCard({ student, index }) {
  return (
    <div className="student-row">
      <div className={`student-avatar student-avatar-${index % 4}`} aria-hidden="true">{getInitials(student.name)}</div>
      <div className="min-w-0 flex-1">
        <h3 className="font-extrabold text-[14px] sm:text-[15px] truncate">{student.name}</h3>
        <p className="mt-0.5 text-[12px] text-[#85847e] truncate">
          {student.studentIdMasked}{student.group ? ` · ${student.group}` : ''}
        </p>
      </div>
      <ShiftTag shift={student.shift} />
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState('');
  const [selectedShift, setSelectedShift] = useState(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const searchInput = useRef(null);
  const resultsRef = useRef(null);
  const parsed = useMemo(() => classifyQuery(query), [query]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const info = classifyQuery(debouncedQuery);
    if ((!debouncedQuery && !selectedShift) || info.kind === 'invalid-id' || info.kind === 'short-name') {
      setData([]);
      setLoading(false);
      setError('');
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');

    async function load() {
      try {
        if (DEMO_MODE) {
          const matches = filterRecords(demoPeople, debouncedQuery, selectedShift);
          if (active) setData(matches);
          return;
        }
        const params = new URLSearchParams();
        if (debouncedQuery) params.set('q', debouncedQuery);
        if (selectedShift) params.set('shift', String(selectedShift));
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !Array.isArray(payload.results)) {
          throw new Error(payload.message || 'Không tải được danh sách. Thử lại nhé!');
        }
        if (active) setData(payload.results);
      } catch (err) {
        if (active && err.name !== 'AbortError') {
          setData([]);
          setError(err.message || 'Lỗi kết nối, thử lại sau nhé.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; controller.abort(); };
  }, [debouncedQuery, selectedShift, retryKey]);

  const isSearchReady = parsed.kind !== 'invalid-id' && parsed.kind !== 'short-name';
  const showResults = Boolean(debouncedQuery || selectedShift);
  const showStale = query.trim() !== debouncedQuery;

  function selectShift(shift) {
    setSelectedShift((current) => current === shift ? null : shift);
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 70);
  }

  function openForm() {
    if (FORM_URL) {
      window.open(FORM_URL, '_blank', 'noopener,noreferrer');
    } else {
      setShowSetup((prev) => !prev);
      window.setTimeout(() => document.getElementById('register')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    }
  }

  return (
    <div className="site-shell min-h-screen">
      <div className="top-banner">🎓 <span>Class of '26, this one is for you.</span> <span className="mx-2 opacity-40">✳</span> Không ai phải hỏi “ê ca mấy?” lần thứ 7749 nữa</div>
      <div className="page-container">
        <header className="flex items-center justify-between py-6 sm:py-7">
          <a href="#top" className="flex items-center gap-2.5 font-black tracking-[-0.08em] text-[23px]" aria-label="Ca Nào Z - trang chủ">
            <span className="logo-icon"><GraduationCap size={23} strokeWidth={2.5} /></span>
            <span>ca nào <span className="text-[#ec5c3b]">z?</span></span>
          </a>
          <div className="hidden md:flex items-center gap-9 text-[13px] font-semibold text-[#73716b]">
            <a href="#search" className="hover:text-[#22221f] transition-colors">Tìm bạn</a>
            <a href="#schedule" className="hover:text-[#22221f] transition-colors">Lịch tốt nghiệp</a>
            <a href="#how" className="hover:text-[#22221f] transition-colors">Cách xài</a>
          </div>
          <button className="pill-button pill-button-dark text-xs sm:text-sm" onClick={openForm}>
            Khai ca của tui <ArrowUpRight size={15} strokeWidth={2.5} />
          </button>
        </header>

        <main id="top">
          <section className="hero-section relative pt-9 pb-8 sm:pt-[70px] sm:pb-[56px]">
            <div className="hero-grid">
              <div className="relative z-10">
                <div className="eyebrow"><span className="eyebrow-dot" /> MINI PROJECT, BIG GRAD ENERGY</div>
                <h1 className="hero-title mt-6">
                  Ủa, <span className="relative inline-block">tụi mình<svg className="underline-svg" viewBox="0 0 330 25" preserveAspectRatio="none" aria-hidden="true"><path d="M4 16 C79 7 149 8 321 7" stroke="#f2ba4d" strokeWidth="13" strokeLinecap="round" fill="none" opacity=".75" /></svg></span><br />
                  <span>cùng ca </span><span className="text-[#ec5c3b] italic">không?</span>
                </h1>
                <p className="mt-6 sm:mt-7 max-w-[550px] leading-[1.8] text-[14px] sm:text-[16px] text-[#77766e]">
                  Tra tên, soi ca, rủ nhau chụp hình. Vì não cá vàng không thể nhớ nổi ai tốt nghiệp ca mấy. <span aria-hidden="true">🫠</span>
                </p>
                <a href="#search" className="inline-flex mt-8 sm:mt-9 items-center gap-2.5 bg-[#f9cc67] border border-[#d8ac4e] text-[#29241c] rounded-full py-3.5 px-6 font-extrabold text-sm hover:bg-[#ffd782] transition-all hover:-translate-y-0.5 shadow-[0_5px_0_#d9a94d]">
                  Tìm đứa bạn ngay <ArrowDown size={16} />
                </a>
                <div className="mt-8 text-[#aaa79e] text-[11px] sm:text-[12px] flex items-center gap-3"><span className="w-8 h-px bg-[#cac7bd]" /> one search bar, zero awkward DMs.</div>
              </div>
              <div className="hero-visual" aria-label="Minh họa lễ tốt nghiệp">
                <div className="deco-star deco-star-one">✳</div>
                <div className="deco-star deco-star-two">✦</div>
                <div className="deco-star deco-star-three">✷</div>
                <div className="graphic-back" />
                <div className="graphic-card">
                  <div className="card-pin" />
                  <div className="font-mono text-[11px] tracking-widest font-bold text-[#807963]">OFFICIAL* GRAD CHECK</div>
                  <div className="graphic-face">🎓</div>
                  <div className="graphic-main">CA NÀO<br /><span>Z?!!</span></div>
                  <div className="graphic-bottom"><span>EST. 2026</span><span>✳ 100% NÃO CÁ VÀNG</span></div>
                </div>
                <div className="graphic-sticker">ê<br />ca mấy?</div>
                <div className="tiny-stamp">#GOODBYE<br />DEADLINES</div>
              </div>
            </div>
          </section>

          <section id="search" className="search-section scroll-mt-10">
            <div className="flex items-end justify-between gap-4 mb-4 sm:mb-5">
              <div>
                <div className="section-kicker">01 / THE STALK ZONE</div>
                <h2 className="section-title mt-2">Đi tìm đồng đội <span className="text-[#e86d4b]">🔍</span></h2>
              </div>
              {DEMO_MODE && <span className="demo-label">DEMO DATA</span>}
            </div>
            <div className="search-panel">
              <label htmlFor="searchBox" className="block font-bold text-[#3e3d38] text-[13px] mb-3">Tên hay MSSV? Gõ gì cũng được.</label>
              <div className="search-control">
                <Search size={21} className="text-[#aaa9a2] shrink-0" aria-hidden="true" />
                <input ref={searchInput} id="searchBox" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
                  placeholder="VD: Nguyễn Minh Anh / AB123456"
                  autoComplete="off" spellCheck="false" />
                {query && <button className="clear-btn" onClick={() => { setQuery(''); searchInput.current?.focus(); }} aria-label="Xóa từ khóa"><X size={17} /></button>}
                <span className="kbd-hint">⌕</span>
              </div>
              <div aria-live="polite" className="mt-3 text-xs text-[#949188] min-h-[20px] flex items-center justify-between gap-3 flex-wrap">
                <SearchHint query={query} />
                <span className="hidden sm:block font-mono text-[10px] tracking-wide">2 LETTERS + 6 DIGITS = MSSV</span>
              </div>
            </div>
          </section>

          <section id="schedule" className="pt-12 sm:pt-[70px] scroll-mt-10">
            <div className="flex justify-between gap-4 items-end mb-5">
              <div>
                <div className="section-kicker">02 / PICK YOUR VIBE</div>
                <h2 className="section-title mt-2">Ba ca, một ngày đáng nhớ.</h2>
              </div>
              <p className="text-xs text-[#96938c] hidden md:block mb-1">Nhấn vào ca để xem ai đi cùng 👇</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {shifts.map((s) => (
                <button key={s.id} aria-pressed={selectedShift === s.id} onClick={() => selectShift(s.id)}
                  className={`shift-card group text-left ${selectedShift === s.id ? 'selected' : ''} ${s.id === 3 ? 'shift-card-active' : ''}`}>
                  <div className="flex justify-between items-start">
                    <span className="card-caption">{s.caption}</span>
                    <span className="text-[24px] leading-none">{s.emoji}</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-7">
                    <span className="shift-number">0{s.id}</span>
                    <span className="font-bold text-[#8c8980]">/ 03</span>
                  </div>
                  <div className="mt-5 border-t border-dashed border-[#d6d1c6] pt-4 flex flex-col gap-2.5 text-[12px] sm:text-[13px]">
                    <div className="flex justify-between items-center gap-2"><span className="text-[#827f76]">Check-in</span><strong className="text-[#33322f]">{s.checkin}</strong></div>
                    <div className="flex justify-between items-center gap-2"><span className="text-[#827f76]">Trao bằng</span><strong className="text-[#33322f]">{s.ceremony}</strong></div>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-2 text-xs font-semibold">
                    <span className="text-[#77746c]">{s.mood}</span>
                    <span className="circle-arrow"><ArrowUpRight size={15} /></span>
                  </div>
                  {selectedShift === s.id && <span className="absolute -top-3 left-4 rounded-full text-[10px] font-black bg-[#25251f] text-white px-3 py-1">ĐANG CHỌN ✦</span>}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#a09d94] mt-3.5">* Lịch ca 1 và ca 2 chưa được công bố đầy đủ, sẽ update ngay khi có thông tin chính thức.</p>
          </section>

          <section id="results" ref={resultsRef} className="pt-12 sm:pt-[68px] scroll-mt-4">
            <div className="flex items-end justify-between gap-3 mb-5">
              <div>
                <div className="section-kicker">03 / THE FRIEND FINDER</div>
                <h2 className="section-title mt-2">Ai chung ca với ai?</h2>
              </div>
              {selectedShift && <button onClick={() => setSelectedShift(null)} className="text-xs rounded-full py-2 px-3 font-bold border border-[#dcd8cf] hover:bg-white flex items-center gap-1"><X size={13} /> Bỏ lọc</button>}
            </div>
            <div className="result-panel">
              <div className="flex items-center justify-between flex-wrap gap-2 p-4 sm:px-6 sm:py-5 border-b border-[#eeeae2] bg-[#fffdfa]">
                <div className="font-extrabold text-[14px] flex items-center gap-2.5"><UsersRound size={19} className="text-[#d36b4a]" /> Danh sách đồng đội</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedShift ? <ShiftTag shift={selectedShift} /> : <span className="text-[11px] text-[#8e8b82]">Tất cả các ca</span>}
                  <span className="text-[10px] text-[#9b988f] font-mono">{showResults && !loading && !showStale && isSearchReady && !error ? `${data.length} FOUND` : 'READY'}</span>
                </div>
              </div>
              <div aria-live="polite" className="min-h-[180px]">
                {!showResults ? (
                  <div className="empty-state"><div className="empty-emoji">👀</div><h3>Ai đó đang đợi được tìm thấy...</h3><p>Gõ tên / MSSV hoặc chọn một ca bên trên để xem danh sách nha.</p></div>
                ) : !isSearchReady ? (
                  <div className="empty-state"><div className="empty-emoji">🧐</div><h3>Khoan, check lại cú pháp nè.</h3><p>MSSV gồm 2 chữ cái và 6 chữ số, còn tên thì nhập tối thiểu 2 ký tự.</p></div>
                ) : loading || showStale ? (
                  <div className="empty-state"><LoaderCircle size={27} className="animate-spin text-[#de8868] mb-3" /><h3>Đang lục trí nhớ tập thể...</h3></div>
                ) : error ? (
                  <div className="empty-state"><div className="empty-emoji">🥲</div><h3>Hơi xui, chưa tải được.</h3><p>{error}</p><button className="mt-4 underline text-sm font-bold" onClick={() => setRetryKey((n) => n + 1)}>Thử lại</button></div>
                ) : data.length === 0 ? (
                  <div className="empty-state"><div className="empty-emoji">🛸</div><h3>Chưa thấy người này đâu...</h3><p>Có khi bạn ấy chưa khai ca. Đi dí bạn ấy đi =)))</p></div>
                ) : (
                  <div className="px-4 sm:px-6 py-1">{data.map((student, index) => <StudentCard key={`${student.name}-${student.studentIdMasked}-${index}`} student={student} index={index} />)}</div>
                )}
              </div>
              <div className="border-t border-[#eeeae2] px-4 sm:px-6 py-3.5 bg-[#fffdfa] flex justify-between items-center gap-3 flex-wrap text-xs text-[#88857e]">
                <span>Chỉ hiện người đã đồng ý công khai.</span>
                <span className="font-bold text-[#625f56]">MSSV luôn được che bớt 🔒</span>
              </div>
            </div>
          </section>

          <section id="register" className="mt-14 sm:mt-[82px] relative overflow-hidden rounded-[26px] bg-[#2c312a] text-white px-6 py-9 sm:px-12 sm:py-11">
            <div className="absolute right-0 top-0 w-[200px] h-[200px] bg-[#f3be62] opacity-10 rounded-full blur-[10px] translate-x-10 -translate-y-20" />
            <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div>
                <div className="text-[#f1c777] text-[11px] tracking-[.18em] font-extrabold mb-3">YOUR TURN, MAIN CHARACTER ✳</div>
                <h2 className="font-black text-[29px] sm:text-[38px] tracking-tight leading-[1.12]">Chưa có tên trong đây? <span className="text-[#f2c56e]">Khai liền!</span></h2>
                <p className="text-[#c1c5b9] mt-3 leading-relaxed max-w-xl text-[13px] sm:text-[14px]">Điền form 30 giây là xong. Sau khi gửi và đồng ý công khai, hội bạn có thể tìm thấy ca của bạn trên web.</p>
              </div>
              <button onClick={openForm} className="w-fit shrink-0 rounded-full px-6 py-4 bg-[#f7cc78] text-[#282b25] font-black text-[14px] flex gap-2 items-center hover:bg-[#ffdc95] transition-colors">
                {FORM_URL ? 'Khai ca ngay' : 'Kết nối Google Form'} <ArrowUpRight size={18} />
              </button>
            </div>
            {showSetup && !FORM_URL && (
              <div className="relative mt-5 rounded-xl border border-white/20 bg-white/10 p-4 text-sm text-[#f2ebdc]">
                Chưa có link Form. Tạo Google Form rồi đặt URL công khai vào biến <code className="text-[#ffe39e]">VITE_FORM_URL</code> trong <code>.env</code> (local) hoặc Vercel Environment Variables (production). Xem file <code>README.md</code> trong source.
              </div>
            )}
          </section>

          <section id="how" className="pt-14 sm:pt-[76px] pb-12 sm:pb-20 scroll-mt-10">
            <div className="section-kicker">04 / HOW TO USE</div>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mt-2 mb-7">
              <h2 className="section-title">Đơn giản như ăn bánh.</h2>
              <span className="text-[#99968c] text-xs italic">3 bước. Không drama.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                ['01', 'Khai ca', 'Điền tên, MSSV, chọn ca tốt nghiệp của bạn.', '📝'],
                ['02', 'Search cái tên', 'Gõ tên hoặc MSSV của đứa bạn hay quên.', '🔎'],
                ['03', 'Hẹn chụp hình', 'Cùng ca thì lên kèo, khác ca thì canh giờ!', '📸'],
              ].map(([number, title, desc, emoji]) => (
                <div className="step-card" key={number}>
                  <div className="flex justify-between items-center mb-7"><span className="font-mono text-xs text-[#bd9d67]">{number} — 03</span><span className="text-2xl">{emoji}</span></div>
                  <h3 className="font-black text-lg mb-2">{title}</h3>
                  <p className="text-[#87837a] text-sm leading-[1.7]">{desc}</p>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2.5 mt-6 text-[#827e75] text-xs leading-relaxed"><CircleHelp size={16} className="shrink-0 mt-0.5" /> <span>Trang này do sinh viên tự khai, không phải lịch xác nhận chính thức của trường. Hãy đối chiếu với thông báo của trường trước ngày lễ.</span></div>
          </section>
        </main>
        <footer className="flex flex-col sm:flex-row justify-between gap-5 border-t border-[#dedbd2] pt-6 pb-10">
          <div><div className="font-black tracking-tight text-lg">ca nào <span className="text-[#eb6e49]">z?</span> <span className="text-sm">🎓</span></div><p className="mt-1 text-[#aaa69b] text-xs">Made for the memories, not for the spreadsheets.</p></div>
          <div className="flex items-center gap-4 sm:gap-6 text-[#837f75] text-xs flex-wrap">
            {CORRECTION_URL && <a className="hover:underline" href={CORRECTION_URL} target="_blank" rel="noopener noreferrer">Sửa / xóa thông tin <ArrowUpRight size={12} className="inline" /></a>}
            <a className="hover:underline" href="#top">Lên đầu trang ↑</a>
            <span>© 2026 · made with ☕ & panic</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
