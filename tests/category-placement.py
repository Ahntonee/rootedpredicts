"""Execute the production CASE expression against representative prediction rows."""
import pathlib
import re
import sqlite3
import unittest

source = (pathlib.Path(__file__).resolve().parents[1] / 'services/homepagePicks.js').read_text(encoding='utf-8')
expression = re.search(r'const categorySql = `(.+?)`;', source, re.S).group(1)


class CategoryPlacement(unittest.TestCase):
    def test_actual_tip_controls_standard_category(self):
        rows = [
            ('Over 1.5', 'Over/Under', '3.5 Goals', '1.5 Goals'),
            ('Under 2.5', 'Over/Under', '3.5 Goals', '2.5 Goals'),
            ('BTTS - No', 'BTTS', '3.5 Goals', 'BTTS'),
            ('Under 3.5', 'Over/Under', '3.5 Goals', '3.5 Goals'),
            ('Over 3.5', 'Over/Under', '2.5 Goals', '3.5 Goals'),
            (' over 1.5 ', 'Over/Under', 'Free Pick', '1.5 Goals'),
            ('Over 1.5', 'Over/Under', 'Banker of the Day', 'Banker of the Day'),
            ('Over 1.5', 'Accumulator', 'Acca Tips', 'Acca Tips'),
            ('Home Win', '1X2', 'Home Win', 'Home Win'),
            ('Away Win', '1X2', 'Away Win', 'Away Win'),
        ]
        with sqlite3.connect(':memory:') as db:
            db.create_function('regexp', 2, lambda pattern, text: bool(re.search(pattern, text or '')))
            for tip, market, category, expected in rows:
                with self.subTest(tip=tip, category=category):
                    actual = db.execute('SELECT ' + expression + ' FROM (SELECT ? AS tip, ? AS market, ? AS category) p',
                                        (tip, market, category)).fetchone()[0]
                    self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
