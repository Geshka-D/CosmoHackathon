"""Team-proposed user tasks from M0 service design, distinct from source facts."""
TASKS = {
    "FIRE": "Диспетчер приоритизирует наземную проверку пожаров и реагирование; спутниковый сигнал не заменяет подтверждение.",
    "FLOOD": "Штаб и дорожная служба обследуют затронутые объекты и проезды, уточняют ограничения движения; карта не заменяет инженерную оценку.",
    "AGRI": "Агроном назначает полевые обследования и решения по поливу после проверки спутникового признака; экономия воды не гарантирована.",
    "INFRA": "Владелец сооружений назначает геодезическую проверку и приоритет обследования/ремонта; сигнал не является заключением о безопасности.",
    "ARCTIC": "Диспетчер снабжения проверяет сообщения, координаты и подтверждения доставки на удалённых маршрутах; связь и доставка — разные результаты.",
    "TRANS": "Диспетчер перевозок проверяет отклонения телематики и корректирует маршрут или назначение машины; местное качество требуется подтвердить.",
    "ENV": "Эколог или водопользователь выбирает места отбора проб и обследования по EO-признаку; загрязнитель требует лабораторного подтверждения.",
    "SSA": "Оператор аппарата анализирует предупреждение и координирует действия; решение принимает уполномоченный оператор, а предотвращение столкновения не гарантируется.",
}


def service_context(selection, snapshot):
    lots = snapshot.lots.set_index("lot_id")
    modes = snapshot.modes.set_index("mode_id")
    return [{"lot_id": row["lot_id"], "mode_id": row["mode_id"], "service": lots.loc[row["lot_id"], "service"],
             "territorial_archetype": lots.loc[row["lot_id"], "territorial_archetype"],
             "task_proposal": TASKS[row["lot_id"]], "task_source": "docs/service-design.md (team proposal, M0)",
             "public_core": bool(modes.loc[row["mode_id"], "public_core"]),
             "mode_coefficients": {key: float(modes.loc[row["mode_id"], key]) for key in ("k_c0", "k_opex", "k_vpub", "k_anchor", "k_commercial")},
             "source": "case_source/data/lots.csv; case_source/data/access_modes.csv"} for row in selection]
