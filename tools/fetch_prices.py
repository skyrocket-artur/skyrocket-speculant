#!/usr/bin/env python3
"""
Загрузка реальных дневных котировок для игры → prices.js

Источники:
  BTC     Yahoo Finance  BTC-USD
  SPX     Yahoo Finance  ^GSPC
  GOLD    Yahoo Finance  GC=F   (фьючерс COMEX, ближний контракт)
  BRENT   Yahoo Finance  BZ=F   (фьючерс ICE, ближний контракт)
  SBER    Московская биржа ISS, режим TQBR
  USDRUB  Московская биржа ISS, USD000UTSTOM; дни без биржевых торгов (с 12.06.2024)
          заполняются официальным курсом ЦБ РФ (только цена закрытия)

Запуск:  python3 tools/fetch_prices.py
"""
import datetime as dt
import json
import os
import time
import urllib.request
import xml.etree.ElementTree as ET

START = dt.date(2017, 10, 1)
TODAY = dt.date.today()
EPOCH = dt.date(2017, 1, 1)
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh) price-fetcher'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'prices.js')

DEC = {'BTC': 0, 'SPX': 1, 'GOLD': 1, 'BRENT': 2, 'SBER': 2, 'USDRUB': 3}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print('  retry', url, e)
            time.sleep(2)


def yahoo(symbol):
    p1 = int(dt.datetime(START.year, START.month, START.day, tzinfo=dt.timezone.utc).timestamp())
    p2 = int(time.time()) + 86400
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?period1={p1}&period2={p2}&interval=1d'
    d = json.loads(get(url))['chart']['result'][0]
    q = d['indicators']['quote'][0]
    rows = {}
    for i, ts in enumerate(d['timestamp']):
        o, h, l, c = q['open'][i], q['high'][i], q['low'][i], q['close'][i]
        if None in (o, h, l, c) or c <= 0:
            continue
        day = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()
        rows[day] = (o, max(h, o, c), min(l, o, c), c)
    return rows


def moex(path):
    rows, start = {}, 0
    while True:
        url = (f'https://iss.moex.com/iss/history/engines/{path}.json?from={START}&till={TODAY}'
               f'&start={start}&iss.meta=off&history.columns=TRADEDATE,OPEN,LOW,HIGH,CLOSE')
        data = json.loads(get(url))['history']['data']
        if not data:
            break
        for d, o, l, h, c in data:
            if not c or not o:
                continue
            rows[dt.date.fromisoformat(d)] = (o, max(h, o, c), min(l, o, c), c)
        start += len(data)
    return rows


def cbr_usd(since):
    url = ('https://www.cbr.ru/scripts/XML_dynamic.asp?'
           f'date_req1={since:%d/%m/%Y}&date_req2={TODAY:%d/%m/%Y}&VAL_NM_RQ=R01235')
    root = ET.fromstring(get(url))
    rows = {}
    for rec in root.findall('Record'):
        d = dt.datetime.strptime(rec.get('Date'), '%d.%m.%Y').date()
        v = float(rec.find('Value').text.replace(',', '.'))
        # курс ЦБ на дату D устанавливается по итогам торгов предыдущего рабочего дня
        d -= dt.timedelta(days=1)
        while d.weekday() >= 5:
            d -= dt.timedelta(days=1)
        rows[d] = (v,)
    return rows


def pack(rows, dec):
    out = []
    for d in sorted(rows):
        if d < START:
            continue
        vals = [round(x, dec) if dec else int(round(x)) for x in rows[d]]
        out.append([(d - EPOCH).days] + vals)
    return out


def main():
    data = {}
    for key, sym in [('BTC', 'BTC-USD'), ('SPX', '^GSPC'), ('GOLD', 'GC=F'), ('BRENT', 'BZ=F')]:
        print('Yahoo', sym)
        data[key] = yahoo(sym)
    print('MOEX SBER')
    data['SBER'] = moex('stock/markets/shares/boards/TQBR/securities/SBER')
    print('MOEX USD000UTSTOM')
    usd = moex('currency/markets/selt/boards/CETS/securities/USD000UTSTOM')
    # 12.06.2024 биржевые торги долларом остановлены санкциями — пропуски заполняем курсом ЦБ
    halt = max(d for d in usd if d <= dt.date(2024, 6, 11))
    print('  биржевые данные до', halt, '— пропуски после заполняем курсом ЦБ')
    for d, v in cbr_usd(halt).items():
        if d > halt and d not in usd:
            usd[d] = v
    # первая биржевая свеча после периода «только ЦБ» бывает с выбросом — открываем её от прошлого закрытия
    prev = None
    for d in sorted(usd):
        row = usd[d]
        if prev is not None and len(prev) == 1 and len(row) == 4:
            o, c = prev[0], row[3]
            usd[d] = (o, min(row[1], max(o, c) * 1.01), max(row[2], min(o, c) * 0.99), c)
        prev = usd[d]
    data['USDRUB'] = usd

    packed = {k: pack(v, DEC[k]) for k, v in data.items()}
    meta = {'updated': str(TODAY), 'epoch': str(EPOCH),
            'last': {k: str(max(v)) for k, v in data.items()}}
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// Реальные дневные котировки. Сгенерировано tools/fetch_prices.py — не редактировать вручную.\n')
        f.write('// Формат строки: [день от 2017-01-01, open, high, low, close] или [день, close] (курс ЦБ).\n')
        f.write('const PRICES_META = ' + json.dumps(meta, ensure_ascii=False) + ';\n')
        f.write('const PRICES = {\n')
        for k, rows in packed.items():
            f.write(f'  {k}: ' + json.dumps(rows, separators=(',', ':')) + ',\n')
        f.write('};\n')
    for k, rows in packed.items():
        print(f'{k:7} {len(rows):5} строк  {rows[0][0]} … {rows[-1][0]}')
    print('→', os.path.normpath(OUT), f'{os.path.getsize(OUT) / 1024:.0f} КБ')


if __name__ == '__main__':
    import urllib.parse  # noqa: F401
    main()
