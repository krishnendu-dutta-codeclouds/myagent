"""Unit tests to verify the Multimodal generation logic."""
import io
import unittest


class TestMultimodalLogic(unittest.TestCase):
    def test_token_estimation(self):
        # Test basic word estimation from usage_tracker
        from backend.usage_tracker import estimate_tokens
        self.assertEqual(estimate_tokens(""), 0)
        self.assertEqual(estimate_tokens("Hello world"), 3)  # 2 words * 1.33 = 2.66 -> 2 + 1 = 3
        self.assertEqual(estimate_tokens("This is a test sentence for embeddings."), 10)

    def test_imports(self):
        # Test that all core functions are importable
        try:
            from backend.multimodal import (
                generate_image,
                generate_vector,
                generate_video_sequence,
                transcribe_audio
            )
            import_ok = True
        except ImportError as exc:
            import_ok = False
            print(f"Import failed: {exc}")
            
        self.assertTrue(import_ok)

    def test_csv_parsing(self):
        # Test CSV parsing functionality
        from backend.document_processor import extract_text_from_csv
        csv_bytes = b"Product,Price,Quantity\nApple,0.99,10\nBanana,0.59,5"
        text = extract_text_from_csv(csv_bytes)
        expected = "Product | Price | Quantity\nApple | 0.99 | 10\nBanana | 0.59 | 5"
        self.assertEqual(text.strip(), expected.strip())

    def test_xlsx_parsing(self):
        # Test Excel XLSX parsing functionality
        from backend.document_processor import extract_text_from_xlsx
        import openpyxl
        
        # Create a real in-memory workbook using openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "SalesData"
        ws.append(["Region", "Revenue"])
        ws.append(["East", "5000"])
        ws.append(["West", "6000"])
        
        buf = io.BytesIO()
        wb.save(buf)
        xlsx_bytes = buf.getvalue()
        
        text = extract_text_from_xlsx(xlsx_bytes)
        self.assertIn("Sheet: SalesData", text)
        self.assertIn("Region | Revenue", text)
        self.assertIn("East | 5000", text)
        self.assertIn("West | 6000", text)

    def test_routing(self):
        # Test universal parsing router routes xlsx and csv correctly
        from backend.document_processor import extract_text_from_file
        import openpyxl
        
        csv_bytes = b"ColA,ColB\nValA,ValB"
        csv_text = extract_text_from_file("test.csv", csv_bytes)
        self.assertEqual(csv_text.strip(), "ColA | ColB\nValA | ValB")
        
        # Test xlsx routing
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Data"
        ws.append(["Header", "Value"])
        ws.append(["X", "100"])
        buf = io.BytesIO()
        wb.save(buf)
        xlsx_text = extract_text_from_file("test.xlsx", buf.getvalue())
        self.assertIn("Sheet: Data", xlsx_text)
        self.assertIn("Header | Value", xlsx_text)
        self.assertIn("X | 100", xlsx_text)


if __name__ == "__main__":
    unittest.main()

