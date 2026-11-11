import { div } from 'gpui-kit'
import { h_flex, v_flex, Button, Input, Scrollbar } from 'gpui-base'
import { EFFORT_CHOICES } from './chat.js'
import { action, disclosureAction, segmentTab, surfaceCard } from './view.js'

export function modelSettingsView(view, t) {
  const inputs = view.settingsInputs
  const hint = text => div().text_size(12).line_height('18px').text_color(t.muted).child(text)
  const labelRow = text => div().pt(2).text_size(12).font_medium().text_color(t.foreground).child(text)
  const field = (id, state, label) => Input.new(state).id(id).accessibility_label(label)
    .w_full().h(36).px(10).rounded(7).bg(t.background).border_1().border_color(t.input)
    .text_size(12.5).font_normal().text_color(t.foreground)
    .on_mouse_down('left', (_e, cx) => { state.focus(); cx.stop_propagation() })

  const modelPickerBlock = (key, title, description) => {
    const open = view.settingsPicker === key
    const currentVal = inputs[key].value()
    const section = v_flex().gap(8).min_w(0)
      .child(h_flex().items_center().justify_between().gap(8)
        .child(div().text_size(14).font_semibold().child(title))
        .child(disclosureAction(`settings-pick-${key}`, open ? '收起模型列表' : '从列表选择', t, cx => view.toggleModelPicker(key, cx), {
          open,
          badge: view.modelChoices.length ? `${view.modelChoices.length}` : '',
        }).disabled(view.modelsStatus === 'loading' || (!open && !view.modelChoices.length))))
      .child(hint(description))
      .child(field(`settings-${key}`, inputs[key], `${title}模型`))

    if (open) {
      const query = view.modelQuery.trim().toLowerCase()
      const matches = view.modelChoices.filter(model => `${model.id} ${model.label}`.toLowerCase().includes(query))
      const pickerCard = v_flex().id(`settings-picker-panel-${key}`).p(10).gap(8).rounded(8)
        .bg(t.background).border_1().border_color(t.border)
        .child(field('settings-model-search', view.modelSearchInput, '搜索模型名称或路由'))
        .child(h_flex().items_center().justify_between()
          .child(hint(matches.length > 40 ? `匹配 ${matches.length} 个模型，显示前 40 个` : `匹配 ${matches.length} 个模型`))
          .when(Boolean(currentVal), el => el.child(div().px(6).py(1).rounded(4).bg(t.surface).text_size(10.5).text_color(t.muted).truncate().max_w(160).child(`当前: ${currentVal}`))))

      if (!matches.length) {
        pickerCard.child(hint('没有匹配的模型，可更换关键词或直接填写模型名称。'))
      } else {
        const choices = v_flex().id('settings-model-options').absolute().inset_0().overflow_y_scroll().gap(3)
        for (const [index, model] of matches.slice(0, 40).entries()) {
          const isSelected = currentVal === model.id
          const itemTitle = model.label === model.id ? model.id : `${model.label} · ${model.id}`
          choices.child(Button.new(`settings-${key}-choice-${index}`).accessibility_label(itemTitle).selected(isSelected)
            .flex_none().w_full().min_w(0).h(30).px(8).rounded(6).overflow_hidden()
            .bg(isSelected ? t.selected : t.surface)
            .border_1().border_color(isSelected ? t.accent : t.surface)
            .hover(s => s.bg(t.hover).border_color(isSelected ? t.accent : t.border))
            .on_click((_e, cx) => {
              inputs[key].set_value(model.id); view.settingsPicker = null; view.settingsError = ''; cx.notify()
            })
            .child(h_flex().w_full().min_w(0).items_center().gap(7)
              .child(div().text_size(11.5).font_semibold().text_color(isSelected ? t.accent : t.dim).child(isSelected ? '✓' : '·'))
              .child(div().flex_1().min_w(0).text_size(12).font_medium().text_color(isSelected ? t.foreground : t.muted).truncate().child(itemTitle))))
        }
        pickerCard.child(div().h(210).relative().child(choices).child(Scrollbar.vertical('settings-model-options').absolute().inset_0()))
      }
      section.child(pickerCard)
    }
    return section
  }

  const catalogDot = view.modelsStatus === 'loading'
    ? t.working
    : view.modelsStatus === 'ready'
      ? t.done
      : view.modelsStatus === 'error'
        ? t.blocked
        : t.muted
  const catalogLabel = view.modelsStatus === 'loading'
    ? '正在获取模型列表…'
    : view.modelsStatus === 'ready'
      ? `已获取 ${view.modelChoices.length} 个可选模型`
      : '从 /v1/models 获取模型目录'

  const form = v_flex().gap(14).w_full().min_w(0)
    .child(surfaceCard('settings-card-catalog', t)
      .child(hint('从服务的模型列表为速览与侧聊分别选择，也可以直接填写完整模型或路由名。'))
      .child(h_flex().items_center().justify_between().gap(8)
        .child(h_flex().items_center().gap(6).flex_1().min_w(0)
          .child(div().size(6).rounded_full().bg(catalogDot))
          .child(div().flex_1().min_w(0).text_size(12).font_medium().text_color(t.foreground).truncate().child(catalogLabel)))
        .child(action('settings-refresh-models', '刷新列表', t, cx => view.loadModels(cx, { force: true }), { disabled: view.modelsStatus === 'loading' })))
      .when(Boolean(view.modelsError), el => el.child(div().text_size(12).line_height('18px').text_color(t.blocked).child(view.modelsError)))
      .when(view.modelsStatus === 'ready' && !view.modelChoices.length, el => el.child(hint('服务未返回可选模型，仍可手动填写。'))))
    .child(surfaceCard('settings-card-summary', t)
      .child(modelPickerBlock('summaryModel', 'Sulan · 速览', '更新项目重点时使用的模型。')))
    .child(surfaceCard('settings-card-chat', t)
      .child(modelPickerBlock('chatModel', 'Side Chat · 侧聊', 'Pi Agent 使用的模型，与速览独立；需支持工具调用。'))
      .child(div().h(1).w_full().bg(t.border))
      .child(v_flex().gap(8)
        .child(labelRow('侧聊思考深度'))
        .child(h_flex().id('settings-effort-group').p(3).gap(3).rounded(8).bg(t.background).border_1().border_color(t.border).flex_wrap()
          .children(EFFORT_CHOICES.map(effort => segmentTab(`settings-effort-${effort.value}`, effort.label, t, cx => {
            view.settingsEffort = effort.value; view.settingsError = ''; cx.notify()
          }, { active: effort.value === view.settingsEffort }))))
        .child(hint('仅对支持 reasoning_effort 的 OpenAI 兼容接口生效。'))))
    .child(surfaceCard('settings-card-agent', t)
      .child(div().text_size(14).font_semibold().child('Pi Agent 服务'))
      .child(hint('负责工作区会话、HC 工具与 billion-context。先运行 npm run agent，再安装新版布局以自动配置连接。'))
      .child(labelRow('本机服务地址'))
      .child(field('settings-agent-endpoint', inputs.agentEndpoint, 'Pi Agent 服务地址'))
      .child(labelRow('Agent 连接令牌'))
      .child(field('settings-agent-token', inputs.agentToken, 'Agent 连接令牌'))
      .child(hint('令牌与模型 API Key 分开，安装器从私有连接文件自动填入。')))
    .child(surfaceCard('settings-card-service', t)
      .child(div().text_size(14).font_semibold().child('共用模型服务'))
      .child(hint('接口地址和 API Key 同时用于速览与 Side Chat。'))
      .child(labelRow('完整接口地址'))
      .child(field('settings-endpoint', inputs.endpoint, '模型接口地址'))
      .child(hint('Anthropic 使用 /v1/messages；OpenAI 使用 /v1/chat/completions。'))
      .child(labelRow('API Key'))
      .child(field('settings-api-key', inputs.apiKey, 'API Key'))
      .child(hint('密钥以遮罩显示。留空表示不发送认证凭据。')))
    .child(hint('设置保存在当前 Herdr Mod 的本地配置中，重启后保留。保存不会请求生成内容，下一次更新或提问时生效。'))

  return v_flex().id('sulan-settings-page').size_full().min_w(0).min_h(0).rounded(10).overflow_hidden()
    .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).font_normal()
    .track_focus(view.focus).on_key_down((event, cx) => view.handleKey(event, cx))
    .child(h_flex().h(46).flex_none().px(14).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border)
      .child(action('settings-back', '← 返回', t, cx => view.closeSettings(cx)))
      .child(div().text_size(14).font_semibold().child('模型与服务设置')))
    .child(div().flex_1().min_h(0).relative()
      .child(v_flex().id('sulan-settings-scroll').absolute().inset_0().overflow_y_scroll().p(16).child(form))
      .child(Scrollbar.vertical('sulan-settings-scroll').absolute().inset_0()))
    .child(v_flex().flex_none().px(14).py(10).gap(8).bg(t.surface).border_t(1).border_color(t.border)
      .when(Boolean(view.settingsError), el => el.child(div().text_size(12).line_height('18px').text_color(t.blocked).child(view.settingsError)))
      .child(h_flex().justify_end().gap(6)
        .child(action('settings-cancel', '取消', t, cx => view.closeSettings(cx)))
        .child(action('settings-save', '保存并返回', t, cx => view.saveSettings(cx), { primary: true }))))
}
