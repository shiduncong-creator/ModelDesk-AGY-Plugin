"""Bind ModelDesk's first-party UI components at verified Antigravity desktop layout slots."""

import json
from pathlib import Path

if __package__:
    from .desktop_thoughts import integrate_thoughts
else:
    from desktop_thoughts import integrate_thoughts


def replace_one(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"桌面布局挂载点已变化，需要重新验证：{old[:60]}")
    return source.replace(old, new)


def locale_script(assets):
    locale = (assets / "locale.js").read_text()
    for name in ("settings", "chrome"):
        labels = json.loads((assets / f"{name}-zh.json").read_text())
        locale = replace_one(locale, f"/* MODELDESK_{name.upper()}_ZH */ {{}}", json.dumps(labels, ensure_ascii=False))
    return (assets / "greeting-zh.js").read_text() + "\n" + locale


def modern_layout(code):
    """Choose by a verified component shape so identical layouts survive version-only updates."""
    signatures = [
        'function wid(){var a=Nj().runtimeEnvironment.userCohort==="google",b=CJ()?.homeGreetingMark',
        'function iqd(){var a=Zj().runtimeEnvironment.userCohort==="google",b=uK()?.homeGreetingMark',
    ]
    found = [index for index, signature in enumerate(signatures) if code.count(signature) == 1]
    if len(found) != 1:
        raise ValueError("无法识别 Antigravity 桌面布局，需要核对新版宿主挂载点")
    return found[0] == 1


def localized_host(code, modern):
    home = "hqd" if modern else "vid"
    greeting = f'b={home}(c,f);'
    node = 'return E.createElement("div",{"data-testid":"home-greeting"'
    code = replace_one(code, greeting + node, greeting + 'b=window.ModelDeskChineseGreeting.home(b)??b;'
                       + node.replace("home-greeting", "modeldesk-home-welcome"))
    # Localize display text while preserving the transcript and reply actions.
    formatter, value = ("KVc", "a") if modern else ("dTc", "b")
    memo = f'()=>{formatter}({value}),[{value}]'
    code = replace_one(code, memo, memo.replace(f'({value})', f'(window.ModelDeskChineseGreeting.chat({value})??{value})'))
    markdown = 'E.createElement(k,{stepIndex:a,animate:!h&&(c===K.CortexStepStatus.RUNNING||c===K.CortexStepStatus.GENERATING)},m)'
    code = replace_one(code, markdown, markdown.removesuffix(',m)') + ',window.ModelDeskChineseGreeting.chat(m)??m)')
    items = 'E.createElement(VWc,{items:y}))))' if modern else 'E.createElement(duc,{items:x}))))))),Z&&'
    value = 'y' if modern else 'x'
    code = replace_one(code, items, items.replace('items:'+value, f'items:modelDeskGreetingItems({value})'))
    row, editing, title, ref = ("NX", "fd", "gd", "Ab") if modern else ("xY", "xc", "Nb", "ac")
    field = f'E.createElement({row},{{isEditing:{editing},editValue:{title},inputRef:{ref}'
    code = replace_one(code, field, field.replace('editValue:'+title, f'editValue:{editing}?{title}:window.ModelDeskLocale.conversationTitle({title})'))
    suggest = 'Lqd' if modern else 'Yid'
    prompt = f'function {suggest}(a,b){{var c=a.prompt||a.label;'
    code = replace_one(code, prompt, prompt.replace('a.prompt||a.label', 'window.ModelDeskLocale.chrome(a.prompt||a.label)'))
    code = replace_one(code, 'onClick:()=>q("Set up my environment")',
                       'onClick:()=>q(window.ModelDeskLocale.chrome("Set up my environment"))')
    code = replace_one(code, 'return a==="now"?"just now":`${a} ago`', 'return window.ModelDeskLocale.ago(a)')
    for label in ("New Conversation", "Toggle Overview Panel", "Search Conversations"):
        key = '"aria-label":' + json.dumps(label)
        if key not in code:
            raise ValueError(f"桌面布局缺少原生标签 {label}")
        code = code.replace(key, '"aria-label":window.ModelDeskLocale.chrome('+json.dumps(label)+')')
    class_names = 'jj' if modern else 'Yi'
    settings = 'E.createElement("div",{className:d},E.createElement("div",{className:'+class_names+'(h?"p-4":"p-6"'
    code = replace_one(code, settings, settings.replace('{className:d}', '{"data-md-settings":"",className:d}'))
    project = 'O' if modern else 'R'
    project_row = f'key:{project}.uri,text:{project}.name,onClick:'
    for old, new in (
        (project_row, project_row.replace('onClick:', 'className:"md-user-label",onClick:')),
        ('text:b??"Project",onClick:', 'text:b??"Project",className:"md-user-label",onClick:'),
        ('spanClassName:"text-xl font-medium truncate",onDoubleClickSpan:N',
         'spanClassName:"md-user-label text-xl font-medium truncate",onDoubleClickSpan:N'),
        ('E.createElement("strong",null,H||`this ${A.lowercase}`)',
         'E.createElement("strong",{"data-md-verbatim":H?"":void 0},H||`this ${A.lowercase}`)'),
    ):
        code = replace_one(code, old, new)
    # These virtual sidebar rows also render user-supplied conversation/project titles.
    # Translate only their fixed empty-state labels before handing them to the row.
    empty_labels = 'label:h==="pinned"?"No pinned conversations":\nh.startsWith("convgroup:")?"Drop to add to group":"No conversations yet"'
    code = replace_one(code, empty_labels, 'label:window.ModelDeskLocale.chrome('+empty_labels[len("label:"):]+')')
    archived = 'jb=H?`${gb} (Archived)`:gb,Yb=NL()' if modern else 'Ia=y?`${Pa} (Archived)`:Pa,Va=fL()'
    title = 'gb' if modern else 'Pa'
    translated = f'window.ModelDeskLocale.chrome({title})'
    code = replace_one(code, archived, archived.replace(title, translated).replace(" (Archived)", "（已归档）"))
    return code


def workshop_overview(code, modern=None):
    if modern is None:
        modern = modern_layout(code)
    # The native "has content" probe opens Overview as soon as a task appears.
    # The workshop owns the default space; the title-bar button and keyboard
    # shortcut still update the shared per-conversation open state.
    state, toggle = ('O', 'r') if modern else ('R', 't')
    code = replace_one(code, state+'=I&&q===!0||q!==!1&&(M||J)', state+'=q===!0')
    code = replace_one(code, f'{state}?(v(void 0),(M||q===!0)&&{toggle}(!1)):(M||I)&&{toggle}(!0)',
                       f'{state}?(v(void 0),{toggle}(!1)):{toggle}(!0)')
    # Discard the old restored Overview flag at hydration, leaving the rest of
    # the pane/session restore path and any manual clicks in this window intact.
    code = replace_one(code, 'b.payload.overviewPanelOpen&&(a.overviewPanelOpen={...b.payload.overviewPanelOpen,...a.overviewPanelOpen});', '')

    # Use the native component props for fixed chrome. Task summaries, filenames,
    # server-defined section titles and third-party plugin labels remain verbatim.
    def chrome(text):
        return 'window.ModelDeskLocale.chrome(' + json.dumps(text) + ')'

    start = code.index('function ' + ('ymd' if modern else 'Sed') + '({cascadeId:a,panelScope:b,onOpened:c})')
    end = code.index(';function ' + ('zmd' if modern else 'Ted') + '()', start)
    rows = code[start:end]
    for text in ('Overview', 'Review', 'Files', 'Terminal', 'Plugins'):
        rows = replace_one(rows, 'label:' + json.dumps(text), 'label:' + chrome(text))
    code = code[:start] + rows + code[end:]
    breakpoint = 'C' if modern else 'B'
    aria = f'"aria-label":{breakpoint}==="small"?"Overview":void 0'
    code = replace_one(code, aria, aria.replace('"Overview"', chrome('Overview')))
    for name, title in [('subagents', 'Subagents'), ('sideQuestions', 'Side Questions'), ('backgroundTasks', 'Background Tasks'),
                        ('goals', 'Goals'), ('documents', 'Documents'), ('artifacts', 'Artifacts'), ('links', 'Links'),
                        ('modifiedFiles', 'Modified Files'), ('uploads', 'Uploads')]:
        field = 'sectionId:' + json.dumps(name) + ',title:'
        code = replace_one(code, field + json.dumps(title), field + chrome(title))
    component = 'omd' if modern else 'Ied'
    section = f'kind:"client",...b,Component:{component}[b.id]'
    code = replace_one(code, section, section.replace('Component:', 'title:window.ModelDeskLocale.chrome(b.title),Component:'))
    for condition in ('w', 'n'):
        branch = condition + '?"See less":"See all"'
        code = replace_one(code, branch, 'window.ModelDeskLocale.chrome(' + branch + ')')
    start = code.index('function ' + ('umd' if modern else 'Oed') + '({enabledSections:')
    end = code.index(';function ' + ('vmd' if modern else 'Ped') + '(', start)
    if '"Customize Sections"' not in code[start:end]:
        raise ValueError("缺少原生概览分区设置标签")
    settings = code[start:end].replace('"Customize Sections"', chrome('Customize Sections'))
    code = code[:start] + settings + code[end:]

    # Running-count strings are built outside the panel and are also used by the
    # inline activity summary and sidebar. Translate them at their typed source.
    count, has_subagents = ('B', 'C') if modern else ('C', 'B')
    running = '`${COUNT} ${HAS&&D?"subagents/tasks":HAS?f>1?"subagents":"subagent":p>1?"tasks":"task"} running`'
    localized = '`${COUNT} ${HAS&&D?"个子代理和后台任务":HAS?"个子代理":"个后台任务"}正在运行`'
    code = replace_one(code, running.replace('COUNT', count).replace('HAS', has_subagents),
                       localized.replace('COUNT', count).replace('HAS', has_subagents))
    code = replace_one(code, '`${d} ${d>1?"subagents":"subagent"} blocked`', '`${d} 个子代理受阻`')
    code = replace_one(code, 'A.push(`${d} blocked`)', 'A.push(`${d} 项受阻`)')
    code = replace_one(code, 'A=q?"Action required":v===K.CascadeRunStatus.CANCELING?"Canceling":u?"Working":w?`${A} task${A===1?"":"s"} running`:x?"Unread":null',
                       'A=q?"需要处理":v===K.CascadeRunStatus.CANCELING?"正在取消":u?"处理中":w?`${A} 个后台任务正在运行`:x?"未读":null')
    code = replace_one(code, '(c?"Compacting":b??"Working")', '(c?"正在压缩上下文":b??"处理中")')
    return code


def integrate(source, assets):
    host = source.decode("utf-8")
    modern = modern_layout(host)
    greeting_component = 'iqd' if modern else 'wid'
    mounting_point = f'function {greeting_component}(){{'
    slots = (assets / "native-activity.js").read_text() + "\n" + (assets / "native-slots.js").read_text()
    thoughts = (assets / "inline-thoughts.js").read_text()
    if modern:
        if __package__:
            from .desktop_runtime235 import bind_runtime
        else:
            from desktop_runtime235 import bind_runtime
        slots = bind_runtime(slots, host)
        thoughts = bind_runtime(thoughts, host)
    code = localized_host(host, modern)
    code = integrate_thoughts(code, modern, replace_one)
    code = workshop_overview(code, modern)
    code = replace_one(code, mounting_point, thoughts + "\n" + slots + "\n" + mounting_point)
    home = f'E.createElement({greeting_component},null)'
    code = replace_one(code, home, f'E.createElement(E.Fragment,null,{home},E.createElement(ModelDeskNativeSurface,{{mode:"home"}}))')
    mobile = '["data-sidebar-scroll-container"]:"true",className:`flex-1 min-h-0 overflow-y-auto flex flex-col relative ${c?"pb-1":"pb-2"}`}'
    code = replace_one(code, mobile, mobile + ',E.createElement(ModelDeskNativeSurface,{mode:"home"})')

    # Keep the native scroll viewport and composer inside their own column.
    start = 'return E.createElement("div",{ref:f,tabIndex:-1,onKeyDown:b,className:Yi("w-full flex h-full min-h-0 flex-col items-center relative outline-none"'
    if modern:
        start = start.replace("className:Yi(", "className:jj(")
    code = replace_one(code, start, 'return E.createElement("div",{"data-md-chat-shell":a??""},' + start.removeprefix("return "))
    end = '!m&&E.createElement(Xhd,{convoViewContainerRef:f,cascadeId:a??"conversation"}))'
    if modern:
        end = end.replace("!m&&", "!n&&").replace("Xhd", "Hpd")
    code = replace_one(code, end, end + ',E.createElement(ModelDeskNativeSurface,{key:a,mode:"chat",conversationId:a}))')

    # Keep Overview in its host React tree while docking the nonmodal variants
    # above the workshop. Sessions without a workshop keep the native placement.
    host_component, context = ('rwd', 'D4') if modern else ('uod', 'S2')
    overview = f"function {host_component}({{children:a}}){{var b=(0,E.useContext)({context}),c=b?.cascadeId,"
    code = replace_one(code, overview, overview +
                       "[mdSlot,setMdSlot]=E.useState(null),"
                       "mdOwner=E.useMemo(()=>({id:c,attach:setMdSlot}),[c]),"
                       "mdDock=modelDeskOverviewDock(mdSlot,c,b?.breakpoint),")
    visible, breakpoint = ('B', 'C') if modern else ('C', 'B')
    reserve = f'H={visible}&&{breakpoint}==="medium",I={visible}&&{breakpoint}===\n"large",J=b?.measuredFor===c'
    code = replace_one(code, reserve, reserve.replace(f'{visible}&&', f'{visible}&&!mdDock&&').replace('\n', ''))
    outer, inner = ('XXc', 'WXc') if modern else ('fDc', 'eDc')
    content = f"E.createElement({outer}.Provider,{{value:{visible}}},E.createElement({inner}.Provider,{{value:d}},a))"
    code = replace_one(code, content, "E.createElement(ModelDeskOverviewDock.Provider,{value:mdOwner}," + content + ")")
    transition, phase, component = ('F', 'owd', 'ymd') if modern else ('G', 'rod', 'Sed')
    panel = f'{transition}.mounted&&E.createElement("div",{{ref:L,...{phase}({transition}.phase),"data-testid":{breakpoint}==="small"'
    code = replace_one(code, panel, panel.replace(".mounted&&", ".mounted&&modelDeskPlaceOverview(mdDock,"))
    end_panel = f'E.createElement({component},{{cascadeId:c,panelScope:h,onOpened:{breakpoint}==="small"?A:void 0}})))'
    code = replace_one(code, end_panel, end_panel + ")")

    control = ('ref:c,"data-testid":"agent-input-box",className:"flex flex-col w-full shrink-0",style:a&&!d?Wgd:void 0}'
               if modern else 'ref:Wo,"data-testid":"agent-input-box",className:"flex flex-col w-full shrink-0",style:Ja?{paddingBottom:"max(0px, env(safe-area-inset-bottom))"}:void 0}')
    code = replace_one(code, control, control + ',E.createElement("div",{"data-md-usage":""})')
    # Remove this one legacy plugin navigation entry before section counts are calculated.
    entries = 'a?Vqd([...b.map(Yqd),...c.map(Zqd)],d):[]' if modern else 'a?hjd([...b.map(kjd),...c.map(ljd)],d):[]'
    code = replace_one(code, entries, entries.replace(')],d)', ').filter(view=>view.key!=="mcp-app/modeldesk-workbench_modeldesk_workbench/open_workbench")],d)'))
    # The host evaluates Overview section definitions at module startup.
    # Register the dictionary before those definitions and keep the entry in strict mode.
    return ("'use strict';\n" + locale_script(assets) + "\n" + code).encode("utf-8")


def client_assets(assets):
    office = Path(assets).parent / "src/office"
    engine = ["sprites", "scene", "events", "motion"]
    scripts = [office / f"pixel-office-{part}.js" for part in engine] + [office / "pixel-office.js"]
    scripts += [assets / name for name in ("workshop.js", "insights.js", "native-layout.js")]
    styles = [assets / name for name in ("native-layout.css", "insights.css", "workshop.css")]
    return (b"\n;\n".join(p.read_bytes() for p in scripts), b"\n".join(p.read_bytes() for p in styles))
