"""Localize only the read-only body that the native thought disclosure renders."""


def integrate_thoughts(code, modern, replace_one):
    for duration in ("b", "r" if modern else "t", "Q"):
        seconds = '${Math.max(1,Number(' + duration + '.seconds))}'
        title = '`Thought for ' + seconds + 's`:"Thought Process"'
        code = replace_one(code, title, '`思考用时 ' + seconds + ' 秒`:"思考摘要"')
    parent = 'className:"cursor-edit group relative text-secondary-foreground pl-2"},'
    if modern:
        # 2.35 renders the markdown directly from the disclosure's thinking prop.
        original = 'E.createElement(g,{animate:m},\na)'
        display = 'E.createElement(ModelDeskInlineThought,{source:a,step:$X(c),markdown:g,animate:m})'
    else:
        original = 'E.createElement(g,{animate:t&&m},q)'
        display = 'E.createElement(ModelDeskInlineThought,{source:q,step:KY(c),markdown:g,animate:t&&m})'
    return replace_one(code, parent + original, parent + display)
