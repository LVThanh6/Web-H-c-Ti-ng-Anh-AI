# LinguaRead AI

Yêu cầu Node.js và npm để chạy backend.

## Chạy chế độ demo (không cần backend)
Mở thư mục bằng một static server (ví dụ `npx serve .`) rồi vào `index.html`. Bấm "Dùng bài mẫu" để thử. Dữ liệu từ vựng là dữ liệu minh họa.

## Chạy với Gemini
1. `npm install`
2. Sao chép `.env.example` thành `.env` (PowerShell: `Copy-Item .env.example .env`) rồi điền `GEMINI_API_KEY` (khóa chỉ nằm ở server, không đưa lên Git).
3. `npm start` → mở http://localhost:3000

Để kiểm tra cú pháp JavaScript, chạy `npm run check`.

## Cấu trúc
- `index.html`, `styles.css`, `app.js`: giao diện và logic (tokenizer, chọn từ, phát âm, từ vựng, flashcard)
- `server.js`: Express + `@google/genai`, schema JSON, giới hạn tốc độ
- Dữ liệu người dùng lưu trong localStorage của trình duyệt

## Giới hạn hiện tại
- DOC cũ chưa hỗ trợ (hãy lưu thành DOCX); PDF gửi trực tiếp cho Gemini; DOCX trích xuất bằng mammoth.
- Chưa có tài khoản, chưa kiểm thử tự động; `pronunciationService` dùng Web Speech API và có thể thay bằng Cloud TTS.

## Đề đọc hiểu trắc nghiệm
Từ trang đọc bấm "Tạo đề đọc hiểu": chọn 1–10 câu, trình độ, ngôn ngữ, độ khó, phạm vi (cả bài hoặc một đoạn). Backend kiểm tra số câu, đủ 4 phương án, một đáp án đúng, bằng chứng khớp nguyên văn, câu hỏi không trùng, rồi chạy một lượt Gemini độc lập để đối chiếu đáp án (không đảm bảo tuyệt đối). Đáp án chuẩn chỉ nằm trong bộ nhớ server (6 giờ) và chỉ gửi về sau khi nộp bài; điểm = đúng/tổng × 10 do server tính. Nếu server khởi động lại, đề cũ không chấm được và cần tạo đề mới. Chế độ demo chỉ có 3 câu cho bài mẫu.
