# ca nào z? 🎓

> "Ủa tụi mình cùng ca không?" — One-page React website tra ca tốt nghiệp theo **tên (không dấu)** hoặc **MSSV (2 chữ + 6 số)**. Bạn bè tự khai ca bằng Google Form; quản lý bằng Google Sheets; Vercel Function truy vấn Apps Script an toàn hơn việc publish nguyên Sheet.

## 1. Mở thử ngay (dữ liệu giả)

Yêu cầu: Node.js **20.19+** (khuyến nghị Node 22).

```bash
npm install
cp .env.example .env
npm run dev
```

Mở `http://localhost:5173`. Mặc định có **DEMO MODE** với 12 bản ghi hoàn toàn hư cấu. Thử tìm `Nguyễn Minh Anh` hoặc `AB123456`, chọn Ca 1 / 2 / 3.

Các lệnh khác:

```bash
npm test       # kiểm tra regex, tìm tiếng Việt, lọc ca, ẩn MSSV
npm run build  # tạo production dist/
npm run preview
```

## 2. Tạo Google Form (miễn phí)

1. Vào https://forms.google.com, tạo Form tên `Ca Nào Z? - Khai ca tốt nghiệp`.
2. Tạo **đúng** các câu hỏi dưới đây (để API tự nhận diện header), theo thứ tự tùy ý:

   | Tên câu hỏi **chính xác** | Kiểu | Thiết lập |
   | --- | --- | --- |
   | `Họ và tên` | Short answer | Required |
   | `MSSV` | Short answer | Required; Response validation → Regular expression → Matches: `^[A-Za-z]{2}[0-9]{6}$` |
   | `Ca tốt nghiệp` | Dropdown | Required; chọn `Ca 1`, `Ca 2`, `Ca 3` |
   | `Lớp / nhóm` | Short answer | Optional |
   | `Đồng ý công khai` | Checkboxes | Required; **chỉ một option**: `Tôi đồng ý` |

3. Trong mô tả Form, giải thích: tên, ca, nhóm (nếu có) sẽ xuất hiện công khai; **chỉ hiện MSSV dạng che bớt**; việc khai thông tin là tự nguyện và có cách yêu cầu sửa/xóa.
4. Tắt thu thập email nếu không cần. Không bật giới hạn "1 phản hồi" nếu muốn mọi người điền không đăng nhập; bản ghi đồng ý công khai sẽ hiện tự động.
5. Tab **Responses** → **Link to Sheets** → tạo bảng tính mới.
6. Lấy URL gửi form qua **Send/Publish/Share → copy link** (giao diện Google có thể thay đổi). Sau này dùng làm `VITE_FORM_URL`.

## 3. Google Sheets — dữ liệu công khai tự động

- Mở bảng tính phản hồi, xác nhận tên tab (thường `Form Responses 1` hoặc `Câu trả lời biểu mẫu 1`). Tên này cần điền vào `SHEET_NAME` trong `apps-script/Code.gs`.
- Hàng nào chọn **`Tôi đồng ý`** và có tên, MSSV, ca hợp lệ sẽ hiện trên web ngay sau khi Google Form ghi vào Sheet. Không cần cột `Duyệt`; nếu đã thêm cột này, bạn có thể giữ lại nhưng API sẽ bỏ qua.
- Nếu cần sửa ca/tên, sửa trực tiếp trong Sheet. Nếu cần ẩn một bản ghi, xóa giá trị `Đồng ý công khai` của dòng đó hoặc xóa dòng theo chính sách dữ liệu của bạn.
- **Không chọn** File → Share → Anyone with link; giữ Sheet ở chế độ riêng tư.
- Nếu trùng MSSV, bản ghi **đồng ý công khai** mới hơn sẽ hiển thị. MSSV chỉ được kiểm tra định dạng, không chứng minh người gửi là chủ MSSV; người biết MSSV của người khác có thể khai sai thông tin.

## 4. Google Apps Script — API riêng tư

1. Từ Sheet chọn **Extensions → Apps Script**.
2. Copy toàn bộ `apps-script/Code.gs` vào code editor. Nếu tab không phải `Form Responses 1`, sửa `SHEET_NAME`. Với deployment đang dùng, vào **Deploy → Manage deployments → Edit → New version → Deploy** sau khi thay code.
3. Trong Apps Script chọn **Project Settings (bánh răng) → Script properties → Add script property**:
   - Property: `API_TOKEN`
   - Value: một chuỗi bí mật dài ngẫu nhiên (ví dụ tạo bằng `openssl rand -hex 24` trong terminal).
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (nếu tài khoản Workspace không cho phép, cần tài khoản Google cá nhân hoặc cấu hình khác).
5. Cấp quyền theo hướng dẫn Google và copy URL dạng `https://script.google.com/macros/s/.../exec`.
6. Apps Script chỉ phản hồi JSON cho POST có **token đúng**. Đừng paste token vào React, đừng public Sheet.

**Lưu ý:** "Anyone" là truy cập kỹ thuật đến endpoint của Script; khóa token là một rào cản cơ bản, **không phải hệ thống chống abuse/rate limit hoàn chỉnh**. Dữ liệu chỉ được lộ theo từng query, nhưng search tên và lọc ca vẫn cho phép xem các bản ghi đồng ý công khai. Không phù hợp để lưu dữ liệu nhạy cảm.

## 5. Deploy Vercel

1. Tạo repo GitHub mới và đẩy toàn bộ source (không đẩy `.env` vì đã có `.gitignore`).
2. Vào https://vercel.com/new → Import repo → chọn Vite (nếu hỏi) → Build command `npm run build`, Output directory `dist`.
3. Trong **Project Settings → Environment Variables**, thêm:

   | Tên biến | Giá trị | Public? |
   | --- | --- | --- |
   | `VITE_DEMO_MODE` | `false` | Có |
   | `VITE_FORM_URL` | Public URL của Google Form | Có |
   | `VITE_CORRECTION_URL` | Form riêng để đề nghị sửa/xóa (khuyến khích) | Có |
   | `SHEETS_API_URL` | URL `/exec` của Apps Script | **Không, server-only** |
   | `SHEETS_API_TOKEN` | Cùng chuỗi với `API_TOKEN` của Script | **Không, server-only** |

4. Deploy. Link miễn phí sẽ có dạng `https://<ten-du-an>.vercel.app` tùy tên khả dụng. Sau mỗi lần đổi `VITE_*`, cần redeploy vì giá trị được đóng gói vào client khi build.
5. Truy cập website → chọn ca / nhập tên → xem dữ liệu đã đồng ý công khai từ Google Sheets.

## 6. Sửa lịch ca 1, ca 2 sau này

Mở `src/App.jsx` tìm mảng `shifts` và thay:

```js
{
  id: 1,
  caption: 'BUỔI SÁNG',
  emoji: '🌤️',
  checkin: 'Đang cập nhật', // ← thay khung giờ chính thức
  ceremony: 'Đang cập nhật', // ← thay khung giờ chính thức
  mood: 'Ngủ dậy sớm vì tấm bằng'
}
```

Ca 3 có sẵn: **check-in 13:00–13:50**, **trao bằng 14:00–16:30**. Không tự suy đoán giờ ca 1 / 2.

## 7. Về sửa/xóa thông tin

Khuyến khích tạo một Google Form khác gồm `MSSV`, `Yêu cầu: sửa/xóa`, `Thông tin cần sửa`, `Cách liên hệ` (không hiển thị trên web); điền link vào `VITE_CORRECTION_URL`. Trước khi sửa/xóa, chủ trang phải xác minh người gửi yêu cầu là chủ dữ liệu bằng cách phù hợp (MSSV không phải chứng thực danh tính). Không đưa thông tin liên hệ vào trang tra cứu.

## 8. API interface

Public website gọi Vercel Function:

```text
GET /api/search?q=nguyen%20minh%20anh
GET /api/search?q=AB123456
GET /api/search?shift=3
GET /api/search?q=an&shift=3
```

Vercel Function gọi Apps Script qua POST **server-to-server**, không gửi secret lên browser. Response ví dụ:

```json
{
  "ok": true,
  "results": [
    {"name":"Nguyễn Minh Anh","shift":3,"group":"Thiết kế","studentIdMasked":"AB****56"}
  ]
}
```

Không dùng `GET /api/search` để dump toàn bộ Sheet; phải có query tên/MSSV hoặc filter ca. Kết quả được giới hạn 40 bản ghi mỗi lần để giữ MVP gọn. Nếu lượng sinh viên lớn, hãy bổ sung pagination, cache và chống abuse trước khi scale.

## 9. Lưu ý vận hành

- **React + Vite** chạy local ở demo mode; khi dùng backend thật, dùng Vercel deploy hoặc `vercel dev` thay `vite dev` để có route `/api/search`.
- Google Apps Script có quota và độ trễ; miễn phí không đồng nghĩa chịu được lượng lớn truy cập cùng lúc.
- Form có thể bị spam hoặc khai sai; dữ liệu đồng ý công khai sẽ hiện tự động. Regex chỉ kiểm tra định dạng MSSV, không xác thực danh tính.
- Không publish toàn bộ Sheet hoặc file CSV chứa MSSV. Không ghi token vào các biến bắt đầu bằng `VITE_`.
- Hãy dùng tài khoản Google bạn có quyền sử dụng để tạo Sheet/Form. Chưa kết nối tài khoản Google/Vercel thì dự án chỉ chạy demo.

## Công nghệ

React 19 + Vite 6 + Tailwind v4 + Lucide + Google Forms/Sheets + Apps Script + Vercel Functions. Không cần database trả phí, không cần đăng nhập người tra cứu. Miễn phí cho MVP cá nhân trong giới hạn của từng dịch vụ.
