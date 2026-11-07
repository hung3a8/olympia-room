# Olympia tại nhà

Tổ chức Đường lên đỉnh Olympia qua trình duyệt: Khởi động (thi riêng + thi chung), Vượt chướng ngại vật, Về đích, câu hỏi phụ. Không có vòng Tăng tốc.

- **Người dẫn** tạo phòng, nhận mã 5 ký tự. Máy người dẫn giữ toàn bộ trạng thái và đáp án.
- **Thí sinh** (1–4) và **khán giả** (không giới hạn) vào bằng mã hoặc liên kết `…/#MÃ`.
- Kết nối trực tiếp WebRTC qua [PeerJS](https://peerjs.com) (dùng máy chủ báo hiệu miễn phí của PeerJS), không cần backend.
- Đề tải trực tiếp từ [olympia-questions](https://lqtue.github.io/olympia-questions/) (CC-BY-SA, bản quyền câu hỏi thuộc VTV).

## Triển khai lên GitHub Pages

Đẩy các file `index.html`, `app.js`, `game.js`, `style.css` lên một repo, rồi bật Settings → Pages → Deploy from branch.

Chạy thử trên máy:

```bash
python3 -m http.server 8000
```

Kiểm tra luật chấm điểm:

```bash
node test.mjs
```

## Luật (mùa 26)

| Phần | Cách chơi | Điểm | Thời gian |
|---|---|---|---|
| Khởi động · riêng | 6 câu/thí sinh | đúng +10 | 5 giây sau khi đọc xong |
| Khởi động · chung | 12 câu, bấm chuông | đúng +10, sai −5 (không âm) | 5 giây bấm chuông, 5 giây trả lời |
| Vượt chướng ngại vật | 4 hàng ngang + ô trung tâm, gõ đáp án | hàng đúng +10; CNV 60/50/40/30 theo số hàng đã mở, 20 sau ô trung tâm; trả lời sai CNV bị loại | 15 giây mỗi hàng |
| Về đích | 3 câu 20/30 điểm, điểm cao thi trước | ngôi sao ×2 (sai trừ); giành quyền: đúng lấy điểm từ người thi, sai −½ | 15 giây (20đ), 20 giây (30đ), 5 giây giành quyền |
| Câu hỏi phụ | bấm chuông khi đồng điểm cao nhất | người đúng đầu tiên thắng | 15 giây |

Kho dữ liệu không có từ khoá và hình CNV nên người dẫn nhập trong phòng chờ (bỏ trống thì bốc ngẫu nhiên). Câu hỏi thực hành ở Về đích không có trong kho.

Trong phòng chờ, người dẫn bật/tắt 11 môn (Lịch sử, Địa lý, Văn học, Toán, Vật lý, Hoá học, Sinh học, Tiếng Anh, Nghệ thuật & Thể thao, Hiểu biết chung, Tư duy logic) theo cột `subject` của kho; mọi câu bốc và câu đổi đều chỉ lấy từ các môn đang bật. Nhãn môn do AI gắn nên có thể lệch.

Người dẫn có thể đổi câu chưa mở, cộng/trừ điểm tay, hoàn tác, và tải lại trang để tiếp tục phòng cũ.
