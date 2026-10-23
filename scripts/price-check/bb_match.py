"""Propose Zeroinfy variant -> BB product/variant links.

Inputs: zi.json (Zeroinfy BB-group products), bb.json ({bb: courses, bk: books}).
Output: out.json (import rows) + review.txt (per product summary).
"""
import json, re, sys, collections

Z = json.load(open('zi.json'))
D = json.load(open('bb.json'))
BB, BK = D['bb'], D['bk']
try:
    OV = json.load(open('overrides.json'))
except FileNotFoundError:
    OV = {}

MON = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
NOW = (2026, 10)  # Oct 2026; Nov 26 exams still ahead

# ------------------------------------------------------------------ text --
def norm(s):
    s = s.lower().replace('’', "'").replace('–', '-').replace('&', ' and ')
    s = re.sub(r'\s+', ' ', s)
    return s

LEVELS = [('ca/cma final', 'CAF'), ('ca-cma final', 'CAF'), ('ca / cs / cma final', 'CAF'), ('ca/cma inter', 'CAI'),
          ('cma final', 'CMAF'), ('cma inter', 'CMAI'), ('ca final', 'CAF'), ('ca inter', 'CAI'),
          ('ca foundation', 'CAFD'), ('refresher', 'REF'), ('acca', 'ACCA'), ('cfa', 'CFA')]

def level(t):
    n = norm(t)
    if 'prep test' in n:
        for k, v in LEVELS:
            if k in n:
                return 'PT-' + v
    if n.startswith('face to face'):
        return 'F2F'
    for k, v in LEVELS:
        if k in n:
            return v
    return '?'

# subject phrases, longest first. value = tuple of subject codes
SUBJ = [
    ('strategic cost management', ('SCM',)), ('strategic financial management', ('SFM',)),
    ('management accounting (group 2)', ('CMA-MA',)), ('management accounting (regular batch group 2)', ('CMA-MA',)),
    ('cost accounting (group 1)', ('CMA-CA',)), ('om and sm', ('CMA-OMSM',)), ('fm and da', ('CMA-FMDA',)),
    ('scm+sfm', ('SCM', 'SFM')), ('business laws and ethics', ('LAW',)),
    ('both group', ('AA', 'LAW', 'DT', 'IDT', 'COST', 'AUD', 'FM', 'SM')),
    ('group 1', ('AA', 'LAW', 'DT', 'IDT')), ('group1', ('AA', 'LAW', 'DT', 'IDT')),
    ('group 2', ('COST', 'AUD', 'FM', 'SM')),
    ('all subjects', ('ALL',)),
    ('set b spom (scpm)', ('SCPM',)), ('set b scpm (scpm)', ('SCPM',)), ('set b scpm (costing)', ('SCPM',)),
    ('set b costing (scpm)', ('SCPM',)), ('spom set b (scpm)', ('SCPM',)), ('spom (scm spm)', ('SCPM',)),
    ('set b spom', ('SCPM',)), ('spom set b', ('SCPM',)), ('scpm', ('SCPM',)),
    ('spom set a - law', ('LAWA',)), ('spom set a', ('LAWA',)),
    ('financial reporting', ('FR',)), ('advanced financial management', ('AFM',)), ('afm', ('AFM',)),
    ('financial management', ('FM',)), ('strategic management', ('SM',)),
    ('direct and indirect tax', ('DT', 'IDT')), ('direct tax and indirect tax', ('DT', 'IDT')),
    ('taxation (dt idt)', ('DT', 'IDT')), ('taxation (dt gst)', ('DT', 'IDT')), ('taxation (income tax and gst)', ('DT', 'IDT')),
    ('taxation', ('DT', 'IDT')),
    ('direct taxation', ('DT',)), ('direct tax', ('DT',)), ('income tax', ('DT',)),
    ('indirect tax', ('IDT',)), ('idt', ('IDT',)), ('gst', ('IDT',)), ('dt', ('DT',)),
    ('auditing and ethics', ('AUD',)), ('audit and ethics', ('AUD',)), ('auditing - ethics', ('AUD',)), ('auditing ethics', ('AUD',)),
    ('auditing', ('AUD',)), ('audit', ('AUD',)),
    ('corporate and other laws', ('LAW',)), ('corporate and other law', ('LAW',)), ('corporate and economic laws', ('LAW',)),
    ('business laws', ('LAW',)), ('business law', ('LAW',)), ('laws', ('LAW',)), ('law', ('LAW',)),
    ('cost and management accounting', ('COST',)), ('costing', ('COST',)), ('cost', ('COST',)),
    ('advanced accounting', ('AA',)), ('advanced accounts', ('AA',)), ('adv. accounting', ('AA',)), ('adv. accounts', ('AA',)),
    ('adv accounts', ('AA',)), ('adv accounting', ('AA',)), ('accounts', ('ACC',)), ('accounting', ('ACC',)),
    ('economics', ('ECO',)), ('maths', ('MATH',)), ('quantitative aptitude', ('MATH',)),
    ('fr', ('FR',)), ('fm', ('FM',)), ('sm', ('SM',)), ('tax', ('DT', 'IDT')),
    ('sfm', ('SFM',)), ('scm', ('SCM',)), ('spmbv', ('SPMBV',)),
]
TYPES = [
    ('practice batch', 'P'), ('practice', 'P'),
    ('exam oriented-regular batch', 'F'), ('exam oriented', 'F'), ('fast track', 'F'), ('fastrack', 'F'), ('fastack', 'F'), ('ft batch', 'F'), ('-ft', 'F'),
    ('regular', 'R'), ('full course', 'R'),
]

def strip_tail(n):
    # cut faculty and attempt parts
    n = re.split(r'\bby\b|\bfor\b|\bapplicable\b|\bclasses\b|\blectures\b|\bvideo\b', n)[0]
    return n

def subjects_types(t, lvl):
    """Ordered (subject, type) list from a title, plus flags."""
    n = norm(t)
    flags = set()
    if 'english' in n:
        flags.add('EN')
    if 'live guidance' in n:
        flags.add('LG')
    if '2.0' in n and 'idt' in n:
        flags.add('IDT2')
    if 'except sm' in n:
        flags.add('EXSM')
    if 'writing practice' in n:
        flags.add('WP')
    if 'hindi' in n and 'idt english' in n:
        flags.add('DTHI'); flags.discard('EN')
    body = strip_tail(n)
    # special: "(IDT - Practice Batch)" outside the body
    m = re.search(r'\(idt - practice batch\)', n)
    tokens = []  # ('S', codes) or ('T', type)
    i = 0
    body = re.sub(r'^(ca/cma|ca-cma|ca / cs / cma|cma|ca)\s+(final|inter|foundation)\s*', '', body)
    body = body.replace('refresher course on', '')
    if lvl in ('CMAI', 'CMAF'):
        body = re.sub(r'group [12]', '', body)
    while i < len(body):
        hit = None
        for k, v in TYPES:
            if body.startswith(k, i) and (i == 0 or not body[i - 1].isalnum()):
                hit = ('T', v, len(k)); break
        if not hit:
            for k, v in SUBJ:
                if body.startswith(k, i) and (i == 0 or not body[i - 1].isalnum()) and (i + len(k) >= len(body) or not body[i + len(k)].isalnum()):
                    hit = ('S', v, len(k)); break
        if hit:
            tokens.append(hit[:2]); i += hit[2]
        else:
            i += 1
    out = []
    pending = []
    types_seen = [v for k, v in tokens if k == 'T']
    for kind, v in tokens:
        if kind == 'S':
            pending.extend(v)
        else:
            for s in pending:
                out.append([s, v])
            if not pending and out:
                # type right after another type ("exam oriented fast track") - ignore
                pass
            pending = []
    for s in pending:
        out.append([s, types_seen[-1] if (types_seen and not out) else None])
    # untyped subjects take the next typed one? default R
    for o in out:
        if o[1] is None:
            o[1] = 'R'
    if m:
        for o in out:
            if o[0] == 'IDT':
                o[1] = 'P'
    # Foundation "accounts" etc fine; Inter 'accounts' means AA
    if lvl in ('CAI', 'PT-CAI'):
        for o in out:
            if o[0] == 'ACC':
                o[0] = 'AA'
    if 'ALL' in [o[0] for o in out]:
        ty = out[0][1]
        all_ = {'CAF': ['FR', 'AFM', 'AUD', 'DT', 'IDT'], 'CAFD': ['ACC', 'LAW', 'MATH', 'ECO'], 'CAI': ['AA', 'LAW', 'DT', 'IDT', 'COST', 'AUD', 'FM', 'SM']}.get(lvl, ['ALL'])
        out = [[s, ty] for s in all_]
    if 'EXSM' in flags:
        out = [o for o in out if o[0] != 'SM']
    # dedupe keep first
    seen = {}
    for s, ty in out:
        seen.setdefault(s, ty)
    return seen, flags

FAC = ['aakash kandoi', 'shubham keswani', 'bhanwar borana', 'sankalp kanstiya', 'sankalp kansitya', 'amit mahajan', 'mohnish vora', 'monish vora',
       'vishal bhattad', 'siddhesh valimbe', 'tharun raj', 'rajkumar', 'shivam mishra', 'karan kumar', 'arjun chhabra',
       'sanjay appan', 'shyam soni', 'yogesh patil', 'deep koradia', 'hardik manchanda', 'akash agrawal', 'shivangi agrawal',
       'satish jalan', 'harsh gupta', 'aagam dalal', 'biplab mondal', 'manisha kabra']

def faculties(t):
    n = norm(t)
    f = set()
    for x in FAC:
        if x in n:
            f.add(x.replace('kansitya', 'kanstiya').replace('monish', 'mohnish'))
    if 'karan sir' in n:
        f.add('karan kumar')
    if 'mvsir' in n:
        f.add('mohnish vora')
    return f

# ---------------------------------------------------------------- attempts --
def mk(y, m):
    return (2000 + y if y < 100 else y, m)

def parse_attempt_zi(s):
    """ZI attempt option -> (start (y,m), onwards bool, extra text)"""
    n = norm(s)
    m = re.match(r'\s*([a-z]+)[- ]?(\d{2,4})\b(.*)', n)
    if not m or m.group(1)[:3] not in MON:
        m2 = re.match(r'\s*(20\d\d)\b(.*)', n)
        if m2:
            return (int(m2.group(1)), 11), False, m2.group(2)
        return None, False, n
    mon = MON[m.group(1)[:3]]
    y = int(m.group(2))
    rest = m.group(3)
    onw = 'onward' in rest
    return mk(y, mon), onw, rest

def bb_attempts(t, variants=None):
    """Set of attempts a BB product covers + onwards flag."""
    n = norm(t)
    att = set()
    onw = 'onward' in n
    # "nov 26/ mn 27/28/29", "may, nov 27/28/29"
    for m in re.finditer(r'\b(jan|feb|mar|may|june|jun|sep|sept|nov|dec)[a-z]*[\' ]*(?:/\s*\w+\s*)?[\' ]*(\d{2,4})\b', n):
        att.add(mk(int(m.group(2)) % 100 if int(m.group(2)) > 99 else int(m.group(2)), MON[m.group(1)[:3]]))
    for m in re.finditer(r'\b(jan|may|sep|nov|june|dec)\s*(?:and|,)\s*(jan|may|sep|nov|june|dec)\s*(\d{2}|20\d\d)\b', n):
        y = int(m.group(3)) % 100; att.add(mk(y, MON[m.group(1)[:3]])); att.add(mk(y, MON[m.group(2)[:3]]))
    for m in re.finditer(r'\b(june|jun)\s*(?:and|,|&)\s*dec(?:ember)?\s*(\d{2,4})\b', n):
        y = int(m.group(2)) % 100; att.add(mk(y, 6)); att.add(mk(y, 12))
    for m in re.finditer(r'\bmn\s*(\d{2})((?:/\d{2})*)', n):
        for yy in [m.group(1)] + re.findall(r'\d{2}', m.group(2)):
            att.add(mk(int(yy), 5)); att.add(mk(int(yy), 11))
    for m in re.finditer(r'\b(may|nov)\s*(\d{2})((?:/\d{2})+)', n):
        for yy in re.findall(r'\d{2}', m.group(3)):
            att.add(mk(int(yy), 5)); att.add(mk(int(yy), 11))
    for m in re.finditer(r'\b(20\d\d)\b', n):
        if not re.search(r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\' /]*' + m.group(1), n):
            if 'income tax act' in n:
                continue
            y = int(m.group(1)) % 100; att.add(mk(y, 5)); att.add(mk(y, 11))
    if variants:
        for v in variants:
            for o in v['options']:
                k, _, val = o.partition(': ')
                if k.lower() in ('exam', 'exams', 'attempt'):
                    a, _, _ = parse_attempt_zi(val)
                    if a:
                        att.add(a)
    return att, onw

def ym_lt(a, b):
    return a < b

def covers(bbatt, bbonw, a, onw):
    if a in bbatt:
        return 3 if (onw == bbonw) else 2
    # sep vs may? CA Inter/Foundation Jan/May/Sep; CMA Jun/Dec. treat june==may? no.
    if bbonw and bbatt and a > min(bbatt):
        return 1
    return 0

# --------------------------------------------------------------- batch/date --
def dates_in(s):
    n = norm(s)
    out = []
    for m in re.finditer(r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\'’ ,]*(20\d\d|\d{2})\b', n):
        y = int(m.group(2)) % 100
        out.append((2000 + y, MON[m.group(1)]))
    return out

def live_rec(s):
    n = norm(s)
    if 'hybrid' in n or 'blended' in n or 'live + rec' in n or 'live+rec' in n:
        return 'H'
    if 'live' in n or 'starting' in n:
        return 'L'
    if 'record' in n or 'recoded' in n:
        return 'R'
    return None

def batchno(s):
    m = re.search(r'batch\s*\)?\s*(\d)', norm(s))
    return int(m.group(1)) if m else None

def level_set(t):
    n = norm(t)
    l = level(t)
    s = {l}
    if re.search(r'ca ?[/-] ?(cs ?/ ?)?cma', n):
        s |= {'CMAF'} if l == 'CAF' else {'CMAI'} if l == 'CAI' else set()
    return s

# ---------------------------------------------------------- faculty pools --
POOL = {
    ('CAF', 'IDT'): ['vishal bhattad', 'siddhesh valimbe', 'tharun raj', 'rajkumar', 'amit mahajan'],
    ('CMAF', 'IDT'): ['vishal bhattad', 'siddhesh valimbe', 'tharun raj', 'rajkumar', 'amit mahajan'],
    ('CAI', 'IDT'): ['vishal bhattad', 'rajkumar', 'amit mahajan'],
    ('CMAI', 'IDT'): ['vishal bhattad', 'rajkumar', 'amit mahajan'],
    ('CAF', 'AFM'): ['shivam mishra', 'sankalp kanstiya'],
    ('CAI', 'COST'): ['sankalp kanstiya', 'yogesh patil'],
    ('CAI', 'SM'): ['mohnish vora', 'shyam soni', 'sanjay appan'],
    ('CAI', 'FM'): ['sankalp kanstiya', 'mohnish vora'],
    ('CAI', 'LAW'): ['karan kumar', 'arjun chhabra', 'harsh gupta', 'biplab mondal'],
    ('CAI', 'DT'): ['bhanwar borana', 'aagam dalal', 'amit mahajan'],
    ('CMAI', 'DT'): ['bhanwar borana', 'amit mahajan'],
}
DEFAULT = {('CAF', 'IDT'): 'siddhesh valimbe', ('CAI', 'IDT'): 'amit mahajan', ('CAF', 'AFM'): 'sankalp kanstiya',
           ('CAI', 'COST'): 'sankalp kanstiya', ('CAI', 'SM'): 'sanjay appan', ('CAI', 'FM'): 'sankalp kanstiya',
           ('CAI', 'DT'): 'bhanwar borana', ('CMAI', 'DT'): 'bhanwar borana'}

def subj_fac(lvl, subj, facs, explicit_only=False):
    pool = POOL.get((lvl, subj))
    if not pool:
        return None
    hit = [f for f in pool if f in facs]
    # Mahajan/Bhanwar both in DT pool: Mahajan teaches DT only in practice batches
    if subj == 'DT' and 'bhanwar borana' in hit and len(hit) > 1:
        hit = ['bhanwar borana']
    if subj == 'FM' and 'sankalp kanstiya' in hit and 'mohnish vora' in hit:
        return '?'
    if len(hit) == 1:
        return hit[0]
    if len(hit) > 1:
        return '?'
    return None if explicit_only else DEFAULT.get((lvl, subj), '?default')

# --------------------------------------------------------------- options --
def opt_kind(name, lvl):
    n = norm(name)
    if 'mode' in n or 'access type' in n or 'deliery' in n:
        return ('MODE', None)
    if 'attempt' in n:
        return ('ATT', None)
    if n in ('batch recording',):
        return ('BATCH', None)
    if 'book option' in n or n == 'options' or n == 'select' or 'mcq' in n:
        return ('BOOK', None)
    if 'language' in n:
        return ('LANG', None)
    if 'offer' in n:
        return ('MISC', None)
    if n in ('group wise', 'subject wise', 'tests', 'subject'):
        return ('PT', n)
    if n == 'batch type' or n == 'afm batch' :
        s, _ = subjects_types(name, lvl)
        return ('BATCH', list(s) or None)
    s, _ = subjects_types(name.replace('Batch Type', '').replace('Batch', ''), lvl)
    if n == 'cma' or n == 'cost':
        return ('BATCH', ['COST'])
    if s:
        return ('BATCH', list(s))
    return ('MISC', None)

def bb_group_subject(k, lvl):
    n = norm(k)
    if n in ('mode', 'books', 'book', 'study material', 'validity', 'views', 'device', 'video validity', 'views and validity',
             'language', 'question bank', 'exam', 'exams', 'attempt', 'make your own bookset', 'type', 'number of subjects',
             'test/series', 'tests/series', 'group wise', 'subject', 'subjects'):
        return n
    if n in ('batch', 'types of batch'):
        return 'BATCH*'
    if n == 'cma':
        return 'COST'
    if n == 'direct taxt':
        return 'DT'
    if 'acocunt' in n:
        return 'AA'
    if n == 'audit batch':
        return 'AUD'
    s, _ = subjects_types(k, lvl if lvl != 'CAFD' else 'CAI')
    if s:
        return '+'.join(s)
    return n

def zi_mode(v):
    n = norm(v or '')
    dev = 'GD'
    if 'live' in n:
        dev = 'LIVE'
    elif 'pen drive' in n or 'pendrive' in n:
        dev = 'PD'
    books = None
    if 'without hard copy' in n or 'without' in n:
        books = False
    elif 'hard copy' in n or 'with' in n:
        books = True
    return dev, books

def bb_mode(v):
    n = norm(v)
    dev = 'GD'
    if 'live at home' in n or n.startswith('online') or 'live + recorded' in n:
        dev = 'LIVE'
    if 'pendrive' in n or 'pen drive' in n:
        dev = 'PD'
    if ' i ' in n or '|' in n:
        dev = 'MIX'
    books = None
    if 'without' in n:
        books = False
    elif 'with' in n:
        books = True
    return dev, books

def batch_score(zv, bv):
    zd, bd = set(dates_in(zv)), set(dates_in(bv))
    s = 0
    why = []
    if zd and bd and zd & bd:
        s += 4; why.append('date')
    elif zd and bd:
        s -= 2
    zl, bl = live_rec(zv), live_rec(bv)
    if zl and bl:
        if zl == bl or 'H' in (zl, bl):
            s += 1
        else:
            s -= 1
    zn, bn = batchno(zv), batchno(bv)
    if zn and bn:
        s += 1 if zn == bn else -0.5
    nz, nb = norm(zv), norm(bv)
    if ('latest' in nz or 'updated' in nz) and ('latest' in nb or 'updated' in nb or 'newly' in nb):
        s += 2
    return s

def split_batch_value(val, subjects):
    """'Batch 1 (DT May 2026 | GST June 2026 Recorded)' -> {subj: text}"""
    out = {}
    if '|' in val and len(subjects) > 1:
        parts = re.split(r'\|', val)
        for p in parts:
            s, _ = subjects_types(p, 'CAI' if 'COST' in subjects or 'AA' in subjects else 'CAF')
            for k in s:
                if k in subjects:
                    out[k] = p
        for k in subjects:
            out.setdefault(k, val)
        return out
    return {k: val for k in subjects}

# ------------------------------------------------------------- BB index --
SUBNAME = {'FR': 'FR', 'AFM': 'AFM', 'AUD': 'Audit', 'DT': 'DT', 'IDT': 'IDT/GST', 'SCPM': 'SCPM', 'LAWA': 'SPOM Set A', 'AA': 'Adv Accounts',
           'LAW': 'Law', 'COST': 'Costing', 'FM': 'FM', 'SM': 'SM', 'ACC': 'Accounts', 'ECO': 'Economics', 'MATH': 'Maths',
           'SFM': 'SFM', 'SCM': 'SCM', 'SPMBV': 'SPMBV'}
TYNAME = {'R': 'Regular', 'F': 'Exam Oriented', 'P': 'Practice'}

def desc(st):
    return ' + '.join(f"{SUBNAME.get(s, s)} {TYNAME[t]}" for s, t in st.items())

# Faculty BB doesn't name in the title, read from batch descriptions on its pages:
# law batches "Batch 1 - Fully Recorded / Batch 2 - Live from 13th July" are CS Arjun
# Chhabra's (same as the products that name him); "Law - Live At Home" is CA Karan Kumar's.
BBFAC = {96: ['arjun chhabra'], 183: ['arjun chhabra'], 376: ['arjun chhabra'], 381: ['arjun chhabra'],
         328: ['arjun chhabra'], 358: ['arjun chhabra'], 367: ['arjun chhabra'], 384: ['arjun chhabra'],
         362: ['arjun chhabra'], 351: ['karan kumar'], 179: ['karan kumar']}
BBI = []
for i, x in enumerate(BB):
    l = level(x['t'])
    st, fl = subjects_types(x['t'], l)
    if any(o.lower().startswith('language:') and 'english' in o.lower() for v in x['vars'] for o in v['options']):
        fl = set(fl) | {'ENOPT'}
    att, onw = bb_attempts(x['t'], x['vars'])
    BBI.append(dict(i=i, lv=level_set(x['t']), l=l, st=st, fl=fl, att=att, onw=onw, fac=faculties(x['t']) | set(BBFAC.get(i, []))))

PROFILE = collections.defaultdict(set)
for b in BBI:
    if not b['att']:
        continue
    ma = min(b['att'])
    for v in BB[b['i']]['vars']:
        for o in v['options']:
            k, _, val = o.partition(': ')
            g = bb_group_subject(k, b['l'])
            subs = list(b['st']) if g == 'BATCH*' and len(b['st']) == 1 else [x for x in g.split('+') if x in b['st']]
            for sb in subs:
                for d in dates_in(val):
                    PROFILE[(b['l'], sb, ma)].add(d)

def profile_score(b, info):
    if not b['att']:
        return 0
    ma = min(b['att'])
    sc = 0
    for sb, zv in info['batches'].items():
        ds = dates_in(zv)
        prof = PROFILE.get((b['l'], sb, ma))
        if not ds or not prof:
            continue
        sc += 1 if any(d in prof for d in ds) else -1
    return sc

NEXT = {'CAF': (2026, 11), 'CAI': (2027, 1), 'CAFD': (2027, 1), 'CMAF': (2026, 12), 'CMAI': (2026, 12)}
CUT = (2026, 10)

def fmt(a):
    return f"{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][a[1]-1]} {a[0]%100}"

def candidates(zl, zst, zfl, zfac, lvl, relax_en=False):
    out = []
    for b in BBI:
        if not (zl & b['lv']):
            continue
        if b['st'] != zst:
            continue
        if ('EN' in zfl) != ('EN' in b['fl']) and not relax_en and 'ENOPT' not in b['fl']:
            continue
        if ('LG' in zfl) != ('LG' in b['fl']):
            continue
        if 'WP' in b['fl']:
            continue
        # faculty per subject
        bad = False
        unsure = []
        if lvl == 'CAFD' and zst.get('ECO') == 'R':
            if ('mohnish vora' in zfac) != ('mohnish vora' in b['fac']):
                continue
        for s in zst:
            zf_ = subj_fac(lvl, s, zfac)
            bf_ = subj_fac(lvl, s, b['fac'])
            if zf_ is None or bf_ is None:
                continue
            zf2 = zf_.replace('?default', '') if zf_ else zf_
            if zf_ == '?default' or bf_ == '?default':
                # one side unnamed: compare against BB default
                zz = DEFAULT.get((lvl, s)) if zf_ == '?default' else zf_
                bb_ = DEFAULT.get((lvl, s)) if bf_ == '?default' else bf_
                if zz is None or bb_ is None:
                    unsure.append(s); continue
                if zz != bb_ and '?' not in (zz, bb_):
                    bad = True; break
                if bf_ == '?default' and zf_ != '?default':
                    unsure.append(s)
                continue
            if zf_ != bf_ and '?' not in (zf_, bf_):
                bad = True; break
        if bad:
            continue
        out.append((b, unsure))
    return out

def pick_product(cands, a, onw, vscore=None):
    scored = []
    for b, unsure in cands:
        c = covers(b['att'], b['onw'], a, onw) if a else 2
        if c > 0:
            scored.append([c, -len(unsure), 0, b, unsure])
    if not scored:
        return None, None, 0
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    top = [s for s in scored if s[0] == scored[0][0] and s[1] == scored[0][1]]
    if len(top) > 1 and vscore:
        for t in top:
            t[2] = vscore(BB[t[3]['i']]) + (10 * profile_score(t[3], INFO_CUR[0]) if a is None else 0)
        if a is None:
            # earliest attempt first among equals
            top.sort(key=lambda t: (-t[2], min(t[3]['att']) if t[3]['att'] else (9999, 1)))
        else:
            top.sort(key=lambda t: -t[2])
    best = top[0]
    ties = [t for t in top if abs(t[2] - best[2]) < 0.01]
    if a is None and len(ties) > 1:
        e = min(ties[0][3]['att']) if ties[0][3]['att'] else None
        ties = [t for t in ties if (min(t[3]['att']) if t[3]['att'] else None) == e]
    return (best[0], best[1], best[3], best[4]), [(t[0], t[1], t[3], t[4]) for t in ties], len(scored)

# ---------------------------------------------------------- variant pick --
def zi_variant_info(p, v, lvl, zst):
    parts = [s.strip() for s in v['t'].split(' / ')]
    info = dict(mode=None, att=None, attraw=None, batches={}, book=None, lang=None, pt={})
    subj = list(zst)
    for i, o in enumerate(p['opts']):
        if i >= len(parts):
            break
        val = parts[i]
        k, extra = opt_kind(o, lvl)
        if k == 'MODE':
            info['mode'] = val
        elif k == 'ATT':
            info['attraw'] = val
            a, onw, rest = parse_attempt_zi(val)
            info['att'] = (a, onw)
            m = re.search(r'\((.*)\)', rest)
            if m and dates_in(m.group(1)):
                for s_, t_ in split_batch_value(m.group(1), subj).items():
                    info['batches'].setdefault(s_, t_)
        elif k == 'BATCH':
            ss = extra or subj
            if not extra and len(subj) > 1 and '|' not in val:
                # e.g. FR batch recording on a combo: applies to FR if present
                ss = ['FR'] if 'FR' in subj else subj
            for s_, t_ in split_batch_value(val, ss).items():
                info['batches'][s_] = t_
        elif k == 'BOOK':
            info['book'] = val
        elif k == 'LANG':
            info['lang'] = val
        elif k == 'PT':
            info['pt'][extra] = val
    return info

def score_bb_variant(bv, info, lvl, zst, zfl):
    s = 0
    notes = []
    unknown_batch = []
    zdev, zbooks = zi_mode(info['mode'])
    if info['book']:
        nb = norm(info['book'])
        if 'without' in nb:
            zbooks = False
        elif 'with' in nb:
            zbooks = True
    for o in bv['options']:
        k, _, val = o.partition(': ')
        g = bb_group_subject(k, lvl)
        if g == 'mode':
            if 'batch' in norm(val):
                g = 'BATCH*'
            else:
                bdev, bbooks = bb_mode(val)
                if bdev == zdev:
                    s += 2
                elif bdev == 'MIX':
                    s += 0.5 if zdev == 'LIVE' else -1
                else:
                    s -= 2
                if bbooks is not None and zbooks is not None:
                    s += 1.5 if bbooks == zbooks else -1.5
                elif bbooks is False and zbooks is not False:
                    s -= 1.5
                continue
        if g in ('books', 'book', 'study material', 'type', 'make your own bookset'):
            nb = norm(val)
            if 'e-book' in nb or 'e book' in nb or 'soft' in nb:
                bb_b = False
            elif 'without' in nb or 'no ' in nb:
                bb_b = False
            else:
                bb_b = True
            if zbooks is not None:
                s += 1.5 if bb_b == zbooks else -1.5
            elif not bb_b:
                s -= 1
            continue
        if g in ('exam', 'exams', 'attempt'):
            a, _, _ = parse_attempt_zi(val)
            if info['att'] and info['att'][0]:
                za = info['att'][0]
                za = za if za >= CUT else NEXT.get(lvl, za)
                if a == za or (a and za and a[0] == za[0] and {a[1], za[1]} <= {5, 6}) or (a and za and a[0] == za[0] and {a[1], za[1]} <= {11, 12}):
                    s += 6
                else:
                    s -= 6
            continue
        if g == 'language':
            en = 'english' in norm(val) and 'hindi' not in norm(val)
            zen = 'EN' in zfl or (info['lang'] and 'english' in norm(info['lang']) and 'hindi' not in norm(info['lang']))
            s += 1 if en == bool(zen) else -1
            continue
        if g in ('validity', 'views', 'device', 'video validity', 'views and validity', 'question bank'):
            continue
        if g in ('number of subjects', 'test/series', 'tests/series', 'group wise', 'subject', 'subjects'):
            # prep tests
            zv = ' '.join(info['pt'].values()).lower()
            nv = norm(val)
            if g in ('test/series', 'tests/series'):
                zt = norm(info['pt'].get('tests', ''))
                ok = set(re.findall(r'\d', zt)) == set(re.findall(r'\d', nv))
            elif g == 'number of subjects':
                ok = norm(info['pt'].get('subject wise', '')) == nv
            elif g == 'group wise':
                ok = norm(info['pt'].get('group wise', '')).rstrip('s') == nv.rstrip('s')
            else:
                zs_ = norm(info['pt'].get('subject', '')).replace(' and ', ' + ').replace('fr afm audit combo', 'combo')
                ok = zs_.replace(' ', '') == nv.replace(' ', '')
            s += 4 if ok else -4
            continue
        # subject batch group
        subs = list(zst) if g == 'BATCH*' else [x for x in g.split('+') if x in zst]
        if not subs and g != 'BATCH*':
            continue
        for sb in subs[:1] if g != 'BATCH*' else (list(zst)[:1] if len(zst) == 1 else []):
            zv = info['batches'].get(sb)
            if zv is None:
                unknown_batch.append(sb)
                continue
            bs = batch_score(zv, val)
            s += bs
            if bs < 3:
                notes.append(f"{SUBNAME.get(sb, sb)} batch: your '{zv}' vs BB '{val}'")
        if g == 'BATCH*' and len(zst) > 1:
            unknown_batch.append('batch')
    return s, notes, unknown_batch

def pick_variant(bbp, info, lvl, zst, zfl):
    vs = bbp['vars']
    if len(vs) == 1:
        sc, notes, unk = score_bb_variant(vs[0], info, lvl, zst, zfl)
        return vs[0], 'single', sc, notes, unk
    res = []
    for v in vs:
        sc, notes, unk = score_bb_variant(v, info, lvl, zst, zfl)
        res.append((sc, v, notes, unk))
    res.sort(key=lambda r: -r[0])
    best = res[0]
    ties = [r for r in res if abs(r[0] - best[0]) < 0.01]
    amb = 'tie' if len(ties) > 1 and len({r[1]['price'] for r in ties}) > 1 else 'clear'
    return best[1], amb, best[0], best[2], best[3]

ORDER = {'high': 2, 'medium': 1, 'low': 0}
def min_conf(a, b):
    return a if ORDER[a] <= ORDER[b] else b

# ---------------------------------------------------------------- main --
BOOKMAP = {0:2,1:51,2:33,3:49,4:48,5:42,6:14,7:13,8:57,9:5,10:16,11:45,12:3,13:43,14:52,15:34,16:36,17:44,18:58,19:47,20:10,21:28,22:29,23:37,24:18,25:41,26:30,27:8,28:15,29:17,30:54,31:53,32:20,33:19,34:21,35:4,36:55,37:60,38:61,39:59,40:29,41:12,42:11,43:56,44:46,45:38,46:6,47:39,48:7}
BOOKCONF = {0: 'medium', 22: 'medium', 40: 'medium', 32: 'low', 33: 'medium', 38: 'medium', 27: 'medium'}
BOOKNOTE = {0: "BB's set is Question Bank + Concept Book with MCQ; yours says Main Book — check it's the same set.",
            22: 'BB sells SCPM Set B books as one product with a book-set choice.',
            40: 'BB sells SCPM Set B books as one product with a book-set choice.',
            32: "BB's closest is the DT Compiler alone; yours includes MCQ — check.",
            33: "BB's set is Compact + Q/A Compiler; yours adds MCQ — check.",
            38: "BB's is the Audit Question Bank; yours says 'with MCQ' — check.",
            27: "BB's pocket book is titled IDT; yours says GST — same subject, check edition."}
SITE_COURSES = OV.get('_site_courses', 'BB Virtuals')
SITE_BOOKS = OV.get('_site_books', 'BB Publication (books)')

rows = []
review = []
INFO_CUR = [None]

def row(p, v, site, status, conf, reason, bbp=None, bv=None):
    rows.append(dict(pid=p['id'], vid=v['id'], pt=p['t'], ph=p['h'], vendor=p['v'], vt=v['t'], site=site,
                     slug=bbp['slug'] if bbp else None, ptitle=bbp['t'] if bbp else None,
                     bvid=(bv['id'] if bv else (bbp.get('dv') or bbp.get('vid') if bbp else None)),
                     blabel=(bv['title'] if bv else None), conf=conf, reason=reason, status=status,
                     _bbprice=(bv['price'] if bv else (bbp['p'] if bbp else None)), _zp=v['p']))

def is_book(p):
    return 'Books' in p['v'] or p['v'] == 'BB Virtual Books'

k_book = -1
for zi, p in enumerate(Z):
    ov = OV.get(str(zi), {})
    lvl = level(p['t'])
    if is_book(p):
        k_book += 1
    if lvl == 'ACCA' or ov.get('*') == 'skip':
        review.append(f"Z{zi} SKIP {p['t']}")
        continue
    if lvl == 'CFA':
        for v in p['vars']:
            row(p, v, SITE_COURSES, 'no_match', 'high', 'CFA is not sold on bbvirtuals.com.')
        review.append(f"Z{zi} NO_MATCH(CFA) {p['t']}")
        continue
    if is_book(p):
        kb = BOOKMAP[k_book]
        bk = BK[kb]
        for v in p['vars']:
            parts = v['t'].split(' / ')
            araw = next((x for x in parts if re.match(r'\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', x.lower())), None)
            a, onw, _ = parse_attempt_zi(araw) if araw else (None, False, '')
            if a and a < CUT and not onw:
                row(p, v, SITE_BOOKS, 'no_match', 'high', f"The {fmt(a)} edition is for an exam that has passed — BB Publication no longer sells it. Consider removing this option from your listing.")
                continue
            bv = None
            if len(bk['vars']) > 1:
                want = ' '.join(parts[1:]).lower()
                bestv = None
                for cand in bk['vars']:
                    t = cand['title'].lower()
                    sc = 0
                    if 'e book' in t or 'e-book' in t or 'soft' in t:
                        sc -= 2
                    for w in ['full set', 'complete', 'question bank', 'concept', 'mcq', 'practical', 'theory']:
                        if w in want and w in t:
                            sc += 3
                    if 'mcq and practical' in want and 'mcq + practical' in t:
                        sc += 5
                    if bestv is None or sc > bestv[0]:
                        bestv = (sc, cand)
                bv = bestv[1]
            conf = BOOKCONF.get(k_book, 'high')
            note = BOOKNOTE.get(k_book, '')
            if a and a < CUT and onw:
                conf = 'medium' if conf == 'high' else conf
                note = (note + ' ' if note else '') + f"Your option says '{araw}'; matched to BB's current edition."

            reason = f"Same book on bbpublication.com: '{bk['t']}'." + (f" {note}" if note else '')
            if p['t'].find('SCPM') >= 0 and 'theory' in v['t'].lower():
                conf = 'low'; reason += " BB has no separate Theory Book option — check."
            row(p, v, SITE_BOOKS, 'suggested', conf, reason, bk, bv)
        review.append(f"Z{zi} BOOK k{k_book} -> K{kb} {bk['t'][:70]} | {p['t'][:70]}")
        continue

    if re.search(r'\b(book|notes|exam kit|compiler|handout)\b', p['t'].lower()) and not re.search(r'batch|course|lecture', p['t'].lower()) and '*' not in ov:
        for v in p['vars']:
            row(p, v, SITE_BOOKS, 'no_match', 'medium', "Couldn't find this book on bbpublication.com.")
        review.append(f"Z{zi} BOOK? not found {p['t']}")
        continue
    zl = level_set(p['t'])
    zst, zfl = subjects_types(p['t'], lvl)
    zfac = faculties(p['t'])
    cands = candidates(zl, zst, zfl, zfac, lvl)
    lines = []
    for v in p['vars']:
        info = zi_variant_info(p, v, lvl, zst)
        a, onw = info['att'] if info['att'] else (None, False)
        conf_cap = 'high'
        attnote = ''
        if a and a < CUT:
            if not onw:
                row(p, v, SITE_COURSES, 'no_match', 'high', f"The {fmt(a)} attempt has passed — BB no longer sells it. Consider removing this option from your listing.")
                lines.append(f"   {v['t'][:60]:60} -> PASSED")
                continue
            a2 = NEXT.get(lvl, a)
            attnote = f" Your option says '{info['attraw']}'; {fmt(a)} has passed, so this is matched to BB's {fmt(a2)} product."
            a = a2
            conf_cap = 'medium'
        # overrides
        key = info['attraw'] or '*'
        forced = ov.get(key, ov.get('*', 'auto'))
        if forced is None:
            row(p, v, SITE_COURSES, 'no_match', 'high', ov.get('reason', 'No matching BB product.'))
            lines.append(f"   {v['t'][:60]:60} -> OVERRIDE no_match")
            continue
        if forced != 'auto':
            bbp = BB[forced]
            b = BBI[forced]
            ties = [None]
            unsure = []
            how = 'override'
        else:
            vsc = lambda bp: pick_variant(bp, info, lvl, zst, zfl)[2]
            INFO_CUR[0] = info
            best, ties, n = pick_product(cands, a, onw, vsc)
            relaxed = False
            if not best and 'EN' in zfl:
                c2 = candidates(zl, zst, zfl, zfac, lvl, relax_en=True)
                best, ties, n = pick_product(c2, a, onw, vsc)
                relaxed = bool(best)
            if not best:
                why = 'BB has no product with ' + desc(zst) + (f" for {fmt(a)}" if a else '') + ('' if cands else ' (any attempt)') + ' with the same faculty.'
                if cands:
                    why += ' Closest BB products are for other attempts: ' + '; '.join(BB[c[0]['i']]['t'] for c in cands[:3])
                row(p, v, SITE_COURSES, 'no_match', 'medium', why)
                lines.append(f"   {v['t'][:60]:60} -> NONE ({len(cands)} cands)")
                continue
            c, _, b, unsure = best
            bbp = BB[b['i']]
            how = 'auto'
        bv, amb, sc, notes, unk = pick_variant(bbp, info, lvl, zst, zfl)
        if info['pt']:
            want = len([k for k in info['pt'] if k != 'subject' or True])
            npt = sum(1 for o in bv['options'] if bb_group_subject(o.partition(': ')[0], lvl) in ('number of subjects', 'test/series', 'tests/series', 'group wise', 'subject'))
            if sc < 4 * npt - 0.01:
                row(p, v, SITE_COURSES, 'no_match', 'high', f"BB's '{bbp['t']}' has no option matching '{' / '.join(info['pt'].values())}' (BB offers: " + '; '.join(x['title'] for x in bbp['vars'][:8]) + ('…' if len(bbp['vars']) > 8 else '') + ").")
                lines.append(f"   {v['t'][:60]:60} -> PT no option")
                continue
        conf = conf_cap
        rs = []
        if how == 'auto':
            if len(ties) > 1:
                conf = 'low'
                rs.append('Several BB products fit equally: ' + '; '.join(BB[t[2]['i']]['t'] for t in ties[1:3]) + '.')
            elif c == 1:
                conf = min_conf(conf, 'medium')
                rs.append(f"BB's product covers {fmt(a)} via 'onwards' from an earlier attempt.")
            elif c == 2 and a:
                if not (onw is False and b['onw']):
                    conf = min_conf(conf, 'medium')
                    rs.append("Your option says 'and onwards'; BB's product is for " + ', '.join(fmt(x) for x in sorted(b['att'])) + " only.")
            if unsure:
                conf = min_conf(conf, 'medium')
                rs.append('BB title does not name the ' + ', '.join(SUBNAME.get(s, s) for s in unsure) + ' faculty; check it is the same teacher.')
        else:
            conf = ov.get('conf', 'medium')
            if ov.get('reason'):
                rs.append(ov['reason'])
        if how == 'auto' and relaxed:
            conf = 'low'
            rs.append("Your listing says English, but BB has no Full English version of this combo — this is BB's standard (Hindi-English) one. Check.")
        if how == 'auto' and a is None and len(ties) <= 1:
            conf = min_conf(conf, 'medium')
            rs.append("Your listing has no attempt option; matched on the batch details.")
        if amb == 'tie':
            conf = min_conf(conf, 'medium')
            rs.append('More than one BB option fits; picked the first — check the batch/mode.')
        if notes:
            conf = min_conf(conf, 'medium')
            rs.extend(notes)
        dev, books = zi_mode(info['mode'])
        bvt = norm(bv['title'])
        if dev == 'LIVE' and 'live' not in bvt and len(bbp['vars']) == 1:
            rs.append('BB lists only recorded/Google Drive mode for this product; your option is Live.')
            conf = min_conf(conf, 'medium')
        if books is False and 'without' not in bvt and not any('without' in norm(x['title']) for x in bbp['vars']):
            rs.append("BB doesn't sell this without books; your option is without hard copy.")
            conf = min_conf(conf, 'medium')
        reason = f"{desc(zst)}{' (English)' if 'EN' in zfl else ''} → BB '{bbp['t']}'"
        if bv and len(bbp['vars']) > 1:
            reason += f", option '{bv['title']}'"
        reason += '.' + attnote + (' ' + ' '.join(rs) if rs else '')
        row(p, v, SITE_COURSES, 'suggested', conf, reason, bbp, bv)
        lines.append(f"   {v['t'][:60]:60} -> {conf[0].upper()} B{bbp and BB.index(bbp)} {bv['title'][:60]} ₹{bv['price']} (ZI ₹{v['p']})")
    review.append(f"Z{zi} [{desc(zst)}{' EN' if 'EN' in zfl else ''}] {p['t'][:90]}  cands={[c[0]['i'] for c in cands][:8]}")
    review.extend(lines)

json.dump(rows, open('out.json', 'w'))
open('review.txt', 'w').write('\n'.join(review))
cnt = collections.Counter((r['status'], r['conf']) for r in rows)
print(len(rows), sorted(cnt.items()))
