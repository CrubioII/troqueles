PROCESOS_OP = [
    ('plancha',           'Plancha',           'preprensa'),
    ('corte',             'Corte',             'corte'),
    ('impresion',         'Impresión',         'impresion'),
    ('laminado_mate',     'Laminado Mate',     'laminado'),
    ('laminado_brillante','Laminado Brillante','laminado'),
    ('uv_total',          'UV Total',          'uv'),
    ('uv_parcial',        'UV Parcial',        'uv'),
    ('muestra',           'Muestra',           'terminado'),
    ('estampado',         'Estampado',         'estampado'),
    ('cl_set',            'CL/SET',            'preprensa'),
    ('positivo',          'Positivo',          'preprensa'),
    ('troquel',           'Troquel',           'troquel'),
    ('troquelado',        'Troquelado',        'troquel'),
    ('terminado',         'Terminado',         'terminado'),
    ('diseno',            'Diseño',            'diseno'),
    ('pegante',           'Pegante',           'pegante'),
    ('tinta',             'Tinta',             'impresion'),
    ('envio',             'Envío',             'logistica'),
    ('recogida',          'Recogida',          'logistica'),
    ('cajas',             'Cajas',             'terminado'),
]

MAQUINAS = [
    ('preprensa',  'Preprensa'),
    ('corte',      'Corte'),
    ('impresion',  'Impresión'),
    ('laminado',   'Laminado'),
    ('uv',         'UV'),
    ('troquel',     'Troquel'),
    ('terminado',  'Terminado'),
    ('estampado',  'Estampado'),
    ('diseno',     'Diseño'),
    ('pegante',    'Pegante'),
    ('logistica',  'Logística'),
]

PROCESO_MAQUINA = {pid: mid for pid, _, mid in PROCESOS_OP}
