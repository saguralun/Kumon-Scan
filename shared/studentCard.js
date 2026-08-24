const fieldLabels = {
	firstName: "ชื่อ",
	lastName: "นามสกุล",
	nickname: "ชื่อเล่น",
	subject: "วิชา",
	phone: "เบอร์โทร",
	active: "สถานะ",
	gender: "เพศ",
	birthDate: "วันเกิด"
};

const inlineDiffFields = [
	"phone",
	"gender",
	"birthDate",
	"active"
];

const nameDiffFields = [
	"firstName",
	"lastName",
	"nickname"
];

export function renderStudentCard(id, data, options = {}) {
	
	const {
		mode = "normal",
		statusCompare = "",
		changes = []
	} = options;
	
	const {
		firstName = "",
		lastName = "",
		nickname = "",
		subject = "-",
		active = false,
		phone = "",
		gender = "",
		birthDate = ""
	} = data;

	const statusChange =
		changes.find(
			change => change.field === "active"
		);

	const statusChangeHtml = statusChange
		? `
			<div class="status-change-info">

				<span class="status-old">
					${statusChange.oldValue === "Active"
						? "🟢 Active"
						: "🔴 Inactive"}
				</span>

				→

				<span class="status-new">
					${statusChange.newValue === "Active"
						? "🟢 Active"
						: "🔴 Inactive"}
				</span>

			</div>
		`
		: "";
		
	const compareText =
		statusCompare === "same"
			? "✔️ ไม่เปลี่ยนแปลง"

		: statusCompare === "changed"
			? `
				⚠️ เปลี่ยนแปลง ${changes.length} รายการ

				${statusChangeHtml}
			`

		: "🆕 นักเรียนใหม่";
	
	const compareBadge =
		mode === "preview"
			? `
				<div class="compare-status ${statusCompare}">
					${compareText}
				</div>
			`
			: "";

	const nameChanges =
		changes.filter(change =>
			nameDiffFields.includes(
				change.field
			)
		);
	
	const nameDiffHtml =
		nameChanges.length > 0

			? `

				<div class="name-diff">

					${nameChanges.map(change => `

						<div class="name-diff-row">

							<span class="old-value">
								${change.oldValue}
							</span>

							<span class="diff-arrow">
								→
							</span>

							<span class="new-value">
								${change.newValue}
							</span>

						</div>

					`).join("")}

				</div>

			`

			: "";
			
	const fullName = 
		`${firstName} ${lastName}`;
	
	const statusClass = 
		active 
			? "active" 
			: "inactive";
	const statusText = 
		active 
			? "Active" 
			: "Inactive";

	const genderText =
		gender === "male" ? "👦 ชาย" :
		gender === "female" ? "👧 หญิง" :
		"-";

	const subjectClass =
		subject === "ME" ? "subject-me" :
		subject === "EFL" ? "subject-efl" :
		subject === "TRP" ? "subject-trp" :
		"subject-default";

	return `
		<div class="student-card-item" data-id="${id}">
			
		<!-- HEADER -->
			<div class="student-header">

				<!-- LEFT -->
				<div class="student-left">
					<div class="student-avatar ${active ? 'active' : 'inactive'}">
						${firstName.charAt(0) || "?"}
					</div>

					<div class="student-name-group">
						<div class="student-id">
							ID: ${id}
						</div>

						<div class="student-name">
							${fullName}
						</div>

						${nameDiffHtml}

						<div class="nickname-pill">
							${nickname || "-"}
						</div>
					</div>
				</div>

				<!-- RIGHT -->
				<div class="student-right">

					${mode === "preview" ? "" : `
						<button class="btn btn-success btn-sm d-flex align-items-center gap-1"
							onclick="toggleStatus('${id}', ${active}, '${fullName}')">
							<i class="bi bi-pencil-square"></i>
								จัดการ
						</button>
					`}
					
					<div class="status status-${statusClass}">
						<span class="status-dot"
								style="background:${active ? '#28a745' : '#dc3545'}"></span>
						${statusText}
					</div>

					${compareBadge}

				</div>

			</div>

			<div class="divider"></div>

			<!-- BODY -->
			<div class="info-grid">

				<div class="info-block">
					<span class="label">
						<i class="bi bi-mortarboard"></i> Subject
					</span>
					<span class="subject-badge ${subjectClass}">
						${subject}
					</span>
				</div>

				<div class="info-block">
					<span class="label">
						<i class="bi bi-calendar"></i> วันเกิด
					</span>
					<span>
						${getChangedValue(
							"birthDate",
							birthDate || "-",
							changes
						)}
					</span>
				</div>

				<div class="info-block">
					<span class="label">
						<i class="bi bi-person"></i> เพศ
					</span>
					<span>
						${getChangedValue(
							"gender",
							genderText,
							changes
						)}
					</span>
				</div>

				<div class="info-block">
					<span class="label">
						<i class="bi bi-phone"></i> เบอร์โทร
					</span>
					<span>
						${getChangedValue(
							"phone",
							phone || "-",
							changes
						)}
					</span>
				</div>

			</div>

		</div>
	`;
}

function getChangedValue(
	field,
	currentValue,
	changes
) {

	const change =
		changes.find(
			c => c.field === field
		);

	if (!change)
		return currentValue;

	return `
		<div class="old-value">
			${change.oldValue}
		</div>

		<div class="new-value">
			${change.newValue}
		</div>
	`;

}