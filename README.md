# LinguaRead AI

Yêu cầu Node.js và npm để chạy backend.

## Mở bài mẫu trực tiếp từ index.html (không cần Gemini hoặc Render)
Có thể nhấp đúp `index.html` trong File Explorer rồi vào **Bài đọc** → **Dùng bài mẫu**. File `samples/offline.js` đi kèm cung cấp dữ liệu cho chế độ `file://`; tra từ có trong bài mẫu chạy ngay trên máy và không gọi Gemini. `samples/*.json` vẫn là dữ liệu nguồn chính.

Nếu sửa hoặc thêm JSON bài mẫu, hãy chạy `npm run build:samples` từ thư mục dự án để tạo lại `samples/offline.js`, rồi mở lại `index.html`. Lần đầu chỉ cần Node.js; không cần chạy server, cài dependency, cấu hình API key, hoặc deploy Render cho chế độ mở file trực tiếp. Bài mẫu hiện dùng nội dung Batman và các mục từ vựng khớp từ cơ sở dữ liệu nguồn; những từ không có trong từ điển sẽ được báo rõ.

Để thêm câu hỏi cố định cho bài mẫu, khai báo trong `quiz.questions` của JSON. Mỗi câu gồm `id`, `question`, `options` (đúng 4 mục với id `A`, `B`, `C`, `D`), `correctAnswer`, `explanation`, `explanationVi`, `evidence` và `optionExplanations` (đối tượng giải thích theo từng id lựa chọn). Nếu mảng `questions` có câu hỏi, giao diện dùng bộ câu hỏi này thay vì tạo câu điền từ tự động; để mảng rỗng thì vẫn dùng chế độ tạo thử tự động hiện tại.

Để dùng các tính năng cần backend/Gemini, chạy `npm start` và mở `http://localhost:3000`.

Để thêm bài mẫu, tạo JSON mới theo cấu trúc của `samples/heroes-community.json` (`id`, `title`, `level`, `text`, `vocabulary`), rồi thêm `id`, `title` và tên file vào mảng `samples` trong `samples/index.json`. Mỗi phần tử trong `vocabulary` là một đối tượng từ vựng có `term` và `vi`; có thể thêm IPA, từ loại, giải thích, ví dụ, từ đồng nghĩa và dạng từ liên quan.

## Chạy với Gemini
1. `npm install`
2. Sao chép `.env.example` thành `.env` (PowerShell: `Copy-Item .env.example .env`) rồi điền `GEMINI_API_KEY` (khóa chỉ nằm ở server, không đưa lên Git).
3. `npm start` → mở http://localhost:3000

Để kiểm tra cú pháp JavaScript, chạy `npm run check`.

## Cấu trúc
- `index.html`, `styles.css`, `app.js`: giao diện và logic (tokenizer, chọn từ, phát âm, từ vựng, flashcard)
- `server.js`: Express + `@google/genai`, schema JSON, giới hạn tốc độ
- `samples/index.json` và `samples/*.json`: danh mục bài mẫu và dữ liệu bài đọc/từ vựng tương ứng
- Bài đọc, từ đã lưu, kết quả tra từ, đề kiểm tra, câu trả lời và kết quả bài làm được tự động lưu trong `localStorage` của trình duyệt trên thiết bị hiện tại; dữ liệu không tự đồng bộ giữa thiết bị. Log lưu cục bộ xem trong Developer Tools → Console (không ghi nội dung bài đọc hoặc từ khóa).

## Giới hạn hiện tại
- DOC cũ chưa hỗ trợ (hãy lưu thành DOCX); PDF gửi trực tiếp cho Gemini; DOCX trích xuất bằng mammoth.
- Chưa có tài khoản, chưa kiểm thử tự động; `pronunciationService` dùng Web Speech API và có thể thay bằng Cloud TTS.

## Đề đọc hiểu trắc nghiệm
Từ trang đọc bấm "Tạo đề đọc hiểu": chọn 1–10 câu, trình độ, ngôn ngữ, độ khó, phạm vi (cả bài hoặc một đoạn). Backend kiểm tra số câu, đủ 4 phương án, một đáp án đúng, bằng chứng khớp nguyên văn, câu hỏi không trùng, rồi chạy một lượt Gemini độc lập để đối chiếu đáp án (không đảm bảo tuyệt đối). Đáp án chuẩn chỉ nằm trong bộ nhớ server (6 giờ) và chỉ gửi về sau khi nộp bài; điểm = đúng/tổng × 10 do server tính. Nếu server khởi động lại, đề cũ không chấm được và cần tạo đề mới.

Khi bài đọc ở chế độ demo, có thể tạo bài kiểm tra thử cục bộ cho nội dung bất kỳ: câu hỏi điền từ lấy trực tiếp từ bài đọc, tự chấm và lưu đề/câu trả lời/kết quả trên trình duyệt. Số câu tối đa phụ thuộc số từ nội dung trong phạm vi đã chọn; bài demo không cần Gemini nhưng câu hỏi không được AI biên soạn.
