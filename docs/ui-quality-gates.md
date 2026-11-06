# Quy tắc kiểm tra UI RallyX

Đây là bước nghiệm thu bắt buộc cho thay đổi UI và cho bộ ảnh/slide demo. Kiểm tra sản phẩm ở kích thước người dùng thực sự dùng trước khi kết luận hoàn thành.

## 1. Layout có giới hạn

Tách vùng tiêu đề, biểu đồ, giá trị, chú giải và trạng thái/footer. Vùng vẽ chỉ được dùng phần diện tích còn lại, không lấn vào tiêu đề hoặc ô bên cạnh. Với Grid/Flex, kiểm tra min-width, min-height, giới hạn co giãn và kích thước tối thiểu của con.

SVG/ảnh/đồng hồ phải giữ tỷ lệ khi thay đổi từng chiều. Tính cả stroke, viền và khoảng đệm. Không đặt đường kính cố định lớn hơn vùng vẽ. Không dùng overflow để che lỗi bố cục.

Nếu ô nhỏ, ưu tiên tiêu đề, giá trị, chất lượng/cảnh báo và số lượng; bỏ trang trí/phụ đề phụ trước. Chú giải/bảng có thể cuộn nội bộ nhưng phải tới được cả dòng đầu và cuối. Không căn giữa danh sách dài làm dòng đầu nằm ngoài vùng cuộn. Nếu phải rút gọn tiêu đề, có dấu hiệu rút gọn và tooltip/tên truy cập đầy đủ.

Không coi tăng chiều cao mặc định, giảm cỡ chữ tùy tiện, giấu nội dung hoặc chỉnh ảnh chụp là sửa nguyên nhân.

## 2. Ma trận kiểm tra

| Trục | Trường hợp phải kiểm tra |
| --- | --- |
| Control | Kích thước gây lỗi, nhỏ nhất hợp lệ, thấp/rộng, hẹp/cao và lớn |
| Màn hình | Desktop 1440–1920 px, 1024 px, 720 px, 390 px |
| Phóng to | 125% và 200%, hoặc viewport tương đương đã nêu rõ; không chỉ tăng độ phân giải ảnh |
| Văn bản | Tiêu đề tiếng Việt dài, đơn vị dài, giá trị nhiều chữ số, nhiều chú giải/trạng thái |
| Dữ liệu | GOOD, OFF/STOP, FAULT/ON, mất kết nối, STALE/BAD, thiếu nguồn, rỗng |
| Chế độ | Runtime/Live, Design, Preview, dialog/builder dùng cùng renderer |
| Tương tác | Resize, cuộn, focus bàn phím, mở lại bố cục đã lưu |

Ô cực nhỏ dùng fallback đã định nghĩa; thông tin quan trọng vẫn phải truy cập được.

## 3. Bằng chứng nghiệm thu

1. Với lỗi đã xác nhận, viết kiểm thử và chạy trên bản cũ để thấy lỗi đúng triệu chứng.
2. Chạy kiểm thử cấu trúc/logic, TypeScript và production build phù hợp.
3. Chạy trình duyệt thật với CSS sản phẩm. Đo bounding box: tiêu đề kết thúc trước vùng vẽ; hình nằm trọn vùng vẽ; chú giải/footer không đè nhau; không tràn ngang trang ngoài canvas có cuộn theo thiết kế. Kiểm tra phần tử con có kích thước tối thiểu cố định.
4. Xác nhận cuộn được tới đầu/cuối; hình tròn có chiều rộng bằng chiều cao.
5. Xem ảnh ở kích thước thực để bắt lỗi chữ, màu và nội dung. DOM test hoặc thumbnail không đủ.
6. Ghi màn hình, chế độ, kích thước, trạng thái dữ liệu, kết quả và ảnh trong ghi chú kiểm chứng. Không báo hoàn thành khi còn trường hợp đã biết chưa qua.

## 4. Ảnh và slide demo

Chuẩn bị dữ liệu có ý nghĩa: biểu đồ có lịch sử, danh sách có bản ghi, cấu hình có nguồn đã gán. Gắn nhãn DEMO/Xem thử. Không sửa số liệu hiện trường để làm đẹp ảnh.

Sau khi sửa app, chụp lại mọi màn hình có renderer bị ảnh hưởng, kể cả bìa/tổng quan dùng cùng ảnh. Xuất lại PowerPoint/PDF/HTML; kiểm tra số trang, ảnh nhúng, liên kết và trang đã render. Xem trang chi tiết ở tỷ lệ trình chiếu, không chỉ kiểm tra file tồn tại. Ghi chú phải phù hợp với dữ liệu trong ảnh.

## 5. Lỗi hồi quy cần nhớ

- Analog Gauge: label/drawing/value chung flex column làm đồng hồ lấn chữ khi resize.
- Indicator Lamp: hình + nhãn + trạng thái vượt chiều cao, đỉnh đèn bị cắt.
- Native distribution: donut 130 px trong vùng vẽ 67 px, căn giữa làm hình tràn lên tiêu đề. Giới hạn theo cả hai chiều và tách chú giải có cuộn.
