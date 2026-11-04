import { useEffect, useState } from 'react';
import { ArrowLeft, Activity, Clock3, Pause, Play, RefreshCw, Save, Square } from 'lucide-react';

const labels = { starting: 'Đang khởi động', preparing: 'Đang chuẩn bị', ready: 'Chờ lượt gửi', idle: 'Sẵn sàng', closing: 'Đang đóng', stopping: 'Đang dừng', running: 'Đang tra cứu', waiting: 'Đang chờ lượt tiếp theo', retrying: 'Đang chờ thử lại', paused: 'Đã tạm dừng', stopped: 'Đã dừng', complete: 'Đã hoàn tất' };
const time = value => value ? new Date(value).toLocaleString('vi-VN') : '—';
export default function CrawlDashboard() {
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = async (signal) => {
    const response = await fetch('/api/crawl', { cache: 'no-store', signal });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || 'Không đọc được tiến độ.');
    setData(payload); setFailure('');
    setDraft(previous => previous ?? { concurrency: payload.control.concurrency, delay: payload.control.delayMs / 1000, retry: payload.control.retryDelayMs / 1000, maxRetries: payload.control.maxRetries, autoBackoff: payload.control.autoBackoff });
  };
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try { await load(controller.signal); }
      catch (error) { if (!controller.signal.aborted) setFailure(error.message); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
    poll();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clock); };
  }, []);
  async function update(values, message) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/crawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Không lưu được cấu hình.');
      await load(); setNotice(message);
    } catch (error) { setFailure(error.message); }
    finally { setBusy(false); }
  }
  const status = data?.status?.source?.type === 'sheets' ? data.status : null;
  const totals = status ?? data?.progress;
  const progress = totals?.planned ? Math.round(totals.checked / totals.planned * 1000) / 10 : 0;
  const waiting = status?.nextAttemptAt ? Math.max(0, Math.ceil((Date.parse(status.nextAttemptAt) - now) / 1000)) : null;
  const alive = data?.worker?.alive === true;
  const stopping = data?.worker?.stopping === true;
  const effectiveState = !data ? 'Đang tải trạng thái' : !alive ? 'Đã dừng' : stopping ? 'Đang dừng sau lượt hiện tại' : data?.stale ? 'Mất cập nhật từ crawler' : status?.pid !== data?.worker?.pid || status?.state === 'stopped' ? 'Đang khởi động' : labels[status?.state] || 'Đang khởi động';
  const field = (name, value) => setDraft(previous => ({ ...previous, [name]: value }));
  const paused = data?.control.paused;
  const workers = status?.pid === data?.worker?.pid ? status?.workers ?? [] : [];
  const activeWorkers = workers.filter(worker => worker.state === 'running').length;
  const remainingMinutes = totals && data ? Math.ceil((totals.planned - totals.checked) * data.control.delayMs / 60000) : null;

  return <main className="crawl-page">
    <header className="crawl-heading">
      <div><a href="/" className="crawl-back"><ArrowLeft size={16} /> Về tra cứu</a><div className="section-kicker">CA NÀO Z? / CRAWLER</div><h1>Theo dõi crawl</h1><p>Tiến độ tự cập nhật mỗi 2 giây.</p></div>
      <span className={`crawl-state ${data?.stale || status?.state === 'stopped' ? 'crawl-state-alert' : ''}`}><Activity size={16} /> {effectiveState}</span>
    </header>
    {failure && <div role="alert" className="crawl-alert">{failure} Dữ liệu đang hiển thị có thể đã cũ.</div>}
    {notice && <div role="status" className="crawl-success">{notice}</div>}
    {data?.stale && alive && <div className="crawl-alert">Không nhận được cập nhật mới trong {data.heartbeatAgeSeconds} giây. Kiểm tra tiến trình crawler trước khi tiếp tục.</div>}
    <section className="crawl-panel" aria-label="Điều khiển crawler">
      <h2>Điều khiển crawler</h2>
      <div className="crawl-actions">
        <button className="crawl-button" disabled={busy || !data?.source || alive} onClick={() => update({ action: 'start' }, 'Đã khởi động crawler. Tiếp tục từ checkpoint đã lưu.')}><Play size={16} /> Start crawler</button>
        <button className="crawl-button crawl-button-stop" disabled={busy || !alive || stopping} onClick={() => update({ action: 'stop' }, 'Đã gửi yêu cầu Stop. Crawler sẽ dừng sau lượt hiện tại và giữ checkpoint.')}><Square size={16} /> {stopping ? 'Đang dừng…' : 'Stop crawler'}</button>
      </div>
      <p className="crawl-muted">Start chạy tiếp các mã chưa tra. Stop kết thúc tiến trình sau lượt hiện tại, giữ toàn bộ dữ liệu để lần sau chạy tiếp.</p>
    </section>
    <section className="crawl-panel" aria-label="Tiến độ tổng">
      <div className="crawl-progress-title"><h2>Tiến độ tổng</h2><strong>{progress}%</strong></div>
      <progress max="100" value={progress} aria-label="Phần trăm hoàn thành" />
      <div className="crawl-metrics">
        <div><span>Đã kiểm tra</span><strong>{totals?.checked ?? 0}<small> / {totals?.planned ?? data?.source?.total ?? 0}</small></strong></div>
        <div><span>Tìm thấy</span><strong>{totals?.found ?? 0}</strong></div>
        <div><span>Đang tra song song</span><strong>{activeWorkers}<small> / {data?.control.concurrency ?? 2}</small></strong></div>
        <div><span>Lượt tiếp theo</span><strong>{waiting === null ? '—' : `${waiting}s`}</strong></div>
      </div>
      <p className="crawl-muted">Kết quả mới nhất: {time(totals?.updatedAt)} · Ước tính theo khoảng cách gửi chung: {remainingMinutes ?? '—'} phút, chưa tính thời gian tải, tạm dừng và thử lại.</p>
      {status?.cooldownUntil && alive && <p role="status" className="crawl-muted">Toàn bộ pool chờ server đến {time(status.cooldownUntil)}.</p>}
    </section>
    <section className="crawl-panel" aria-label="Các worker crawl">
      <h2>Các worker crawl</h2>
      <p className="crawl-muted">Mỗi worker giữ một phiên trình duyệt riêng và nhận MSSV từ hàng đợi chung. Khoảng cách gửi được áp dụng cho cả pool.</p>
      {workers.length ? <div className="crawl-table-wrap"><table><thead><tr><th>Worker</th><th>Trạng thái</th><th>MSSV</th><th>Retry</th><th>Thử lại lúc</th></tr></thead><tbody>{workers.map(worker => <tr key={worker.id}>
        <td>#{worker.id}</td><td>{worker.retiring ? 'Thu hồi sau lượt hiện tại' : paused && ['ready', 'retrying', 'idle'].includes(worker.state) ? labels.paused : labels[worker.state] || worker.state}</td><td className="crawl-code">{worker.studentId || '—'}</td><td>{worker.retryCount}</td><td>{time(worker.nextAttemptAt)}</td>
      </tr>)}</tbody></table></div> : <p className="crawl-muted">{alive ? 'Đang khởi tạo pool worker…' : 'Bấm Start để khởi tạo pool worker.'}</p>}
    </section>
    <div className="crawl-columns">
      <section className="crawl-panel">
        <h2>Danh sách MSSV từ Excel</h2>
        {data?.source ? <>
          <p className="crawl-muted"><strong>{data.source.total}</strong> mã duy nhất từ {data.source.files.length} file · {data.source.entries} lượt xuất hiện · đã loại <strong>{data.source.duplicates}</strong> lượt trùng.</p>
          <ul className="crawl-muted">{data.source.files.map(file => <li key={file.name}>{file.name} · {file.sheets.length} tab · {file.sheets.reduce((sum, sheet) => sum + sheet.entries, 0)} mã hợp lệ trước lọc trùng</li>)}</ul>
          {data.source.invalid > 0 && <p className="crawl-alert">Bỏ qua {data.source.invalid} ô MSSV sai định dạng. Mã hợp lệ gồm 2 chữ và 6 số.</p>}
          <p className="crawl-muted">Đọc tất cả các tab, chuẩn hóa chữ hoa và lọc trùng giữa các file. Mã đã có checkpoint được bỏ qua, kể cả lượt không tìm thấy kết quả.</p>
          <p className="crawl-muted">Thêm hoặc sửa file .xlsx trong data để cập nhật danh sách khi crawler đang chạy. Các lượt đang tra vẫn hoàn tất và lưu kết quả.</p>
          {alive && !status && <p className="crawl-alert">Crawler đang dùng phiên bản cũ. Bấm Stop rồi Start để chuyển sang danh sách Excel và cập nhật tiến độ.</p>}
        </> : <p className="crawl-muted">Thêm file .xlsx có cột MSSV, Rollnumber hoặc Mã số sinh viên vào thư mục data trước khi Start.</p>}
      </section>
      <section className="crawl-panel">
        <h2><Clock3 size={19} /> Chạy song song & thời gian chờ</h2>
        <p className="crawl-muted">Thay đổi áp dụng khi crawler đang chờ, không cần khởi động lại.</p>
        {draft && <form onSubmit={event => { event.preventDefault(); update({ concurrency: Number(draft.concurrency), delayMs: Number(draft.delay) * 1000, retryDelayMs: Number(draft.retry) * 1000, maxRetries: Number(draft.maxRetries), autoBackoff: draft.autoBackoff }, 'Đã lưu. Pool sẽ nhận cấu hình trong khoảng 1 giây; worker đang tra sẽ hoàn thành trước khi thu hồi.'); }}>
          <label>Số worker song song<input type="number" min="1" max="4" step="1" required value={draft.concurrency} onChange={event => field('concurrency', event.target.value)} /></label>
          <label>Khoảng cách gửi chung cho cả pool (giây)<input type="number" min="3" max="600" step="1" required value={draft.delay} onChange={event => field('delay', event.target.value)} /></label>
          <label>Chờ thử lại khi lỗi (giây)<input type="number" min="10" max="3600" step="1" required value={draft.retry} onChange={event => field('retry', event.target.value)} /></label>
          <label>Số lần thử lại tối đa<input type="number" min="0" max="10" step="1" required value={draft.maxRetries} onChange={event => field('maxRetries', event.target.value)} /></label>
          <label className="crawl-checkbox"><input type="checkbox" checked={draft.autoBackoff} onChange={event => field('autoBackoff', event.target.checked)} /> Tự tăng gấp đôi thời gian chờ sau mỗi lần lỗi</label>
          <p className="crawl-muted">Đang lưu: {data.control.concurrency} worker · cả pool gửi tối đa 1 lượt/{data.control.delayMs / 1000}s · retry {data.control.retryDelayMs / 1000}s · tối đa {data.control.maxRetries} lần.</p>
          <button className="crawl-button" type="submit" disabled={busy}><Save size={16} /> {busy ? 'Đang lưu…' : 'Lưu cấu hình pool'}</button>
        </form>}
        <button className="crawl-button crawl-button-secondary" disabled={busy || !alive || stopping} onClick={() => update({ paused: !paused }, paused ? 'Đã gửi yêu cầu tiếp tục.' : 'Đã gửi yêu cầu tạm dừng sau lượt đang tra cứu.')}>
          {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'Tiếp tục' : 'Tạm dừng sau lượt hiện tại'}
        </button>
        <p className="crawl-muted">Tự thử lại cho lỗi mạng, timeout, HTTP 429/5xx. HTTP 429/5xx cho cả pool chờ; luôn giữ thời gian tối thiểu server yêu cầu. CAPTCHA hoặc kết quả lạ sẽ dừng pool sau khi các lượt đang chạy lưu xong.</p>
        {!alive && <p className="crawl-muted">Bấm Start crawler ở đầu trang để chạy tiếp từ checkpoint.</p>}
      </section>
      <section className="crawl-panel"><h2><RefreshCw size={19} /> Theo từng nhóm</h2>
        <div className="crawl-table-wrap"><table><thead><tr><th>Nhóm</th><th>Đã tra</th><th>Tìm thấy</th></tr></thead><tbody>{(totals?.groups || []).map(group => <tr key={group.prefix}><td>{group.prefix}xxxx</td><td>{group.checked}/{group.planned}</td><td>{group.found}</td></tr>)}</tbody></table></div>
        <h2 className="crawl-subheading">Lỗi gần nhất</h2>
        {status?.lastError ? <div className="crawl-error-detail"><p>{time(status.lastError.at)}</p><p>{status.lastError.message}</p></div> : <p className="crawl-muted">Chưa ghi nhận lỗi trong phiên này.</p>}
        <h2 className="crawl-subheading">Nhật ký gần đây</h2>
        <ol className="crawl-events">{[...(status?.events || [])].reverse().map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString('vi-VN')}</time><span>{event.message}</span></li>)}</ol>
      </section>
    </div>
    <p className="crawl-muted">Trang quản lý hoạt động trên localhost cùng máy chạy crawler. Không hiển thị tên hoặc hồ sơ sinh viên.</p>
  </main>;
}
