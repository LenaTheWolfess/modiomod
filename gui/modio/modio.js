var g_ModsAvailableOnline = [];
/**
 * Mod definitions loaded from the files, including invalid mods.
 */
var g_Mods = {};
/**
 * Indicates if we have encountered an error in one of the network-interaction attempts.
 *
 * We use a global so we don't get multiple messageBoxes appearing (one for each "tick").
 *
 * Set to `true` by showErrorMessageBox
 * Set to `false` by init, updateModList, downloadFile, and cancelRequest
 */
var g_Failure;

/**
 * Indicates if the user has cancelled a request.
 *
 * Primarily used so the user can cancel the mod list fetch, as whenever that get cancelled,
 * the modio state reverts to "ready", even if we've successfully listed mods before.
 *
 * Set to `true` by cancelRequest
 * Set to `false` by updateModList, and downloadFile
 */
var g_RequestCancelled;

var g_RequestStartTime;

/**
 * Returns true if ModIoAdvanceRequest should be called.
 */
var g_ModIOState = {
	/**
	 * Finished status indicators
	 */
	"ready": progressData => {
		// GameID acquired, ready to fetch mod list
		if (!g_RequestCancelled)
			updateModList();
		return true;
	},
	"listed": progressData => {
		// List of available mods acquired

		// Only run this once (for each update).
		if (Engine.GetGUIObjectByName("modsAvailableList").list.length)
			return true;

		hideDialog();
		Engine.GetGUIObjectByName("refreshButton").enabled = true;
		g_ModsAvailableOnline = Engine.ModIoGetMods();
		g_Mods = Engine.GetAvailableMods();
		displayMods();
		return true;
	},
	"success": progressData => {
		// Successfully acquired a mod file
		hideDialog();
		Engine.GetGUIObjectByName("downloadButton").enabled = true;
		g_Mods = Engine.GetAvailableMods();
		displayMods();
		return true;
	},
	/**
	 * In-progress status indicators.
	 */
	"gameid": progressData => {
		// Acquiring GameID from mod.io
		return true;
	},
	"listing": progressData => {
		// Acquiring list of available mods from mod.io
		return true;
	},
	"downloading": progressData => {
		// Downloading a mod file
		updateProgressBar(progressData.progress, g_ModsAvailableOnline[selectedModIndex()].filesize);
		return true;
	},
	/**
	 * Error/Failure status indicators.
	 */
	"failed_gameid": progressData => {
		// Game ID couldn't be retrieved
		showErrorMessageBox(
			sprintf(translateWithContext("mod.io error message", "Game ID could not be retrieved.\n\n%(technicalDetails)s"), {
				"technicalDetails": progressData.error
			}),
			translateWithContext("mod.io error message", "Initialization Error"),
			[translate("Abort"), translate("Retry")],
			[closePage, init]);
		return false;
	},
	"failed_listing": progressData => {
		// Mod list couldn't be retrieved
		showErrorMessageBox(
			sprintf(translateWithContext("mod.io error message", "Mod List could not be retrieved.\n\n%(technicalDetails)s"), {
				"technicalDetails": progressData.error
			}),
			translateWithContext("mod.io error message", "Fetch Error"),
			[translate("Abort"), translate("Retry")],
			[cancelModListUpdate, updateModList]);
		return false;
	},
	"failed_downloading": progressData => {
		// File couldn't be retrieved
		showErrorMessageBox(
			sprintf(translateWithContext("mod.io error message", "File download failed.\n\n%(technicalDetails)s"), {
				"technicalDetails": progressData.error
			}),
			translateWithContext("mod.io error message", "Download Error"),
			[translate("Abort"), translate("Retry")],
			[cancelRequest, downloadMod]);
		return false;
	},
	"failed_filecheck": progressData => {
		// The file is corrupted
		showErrorMessageBox(
			sprintf(translateWithContext("mod.io error message", "File verification error.\n\n%(technicalDetails)s"), {
				"technicalDetails": progressData.error
			}),
			translateWithContext("mod.io error message", "Verification Error"),
			[translate("Abort")],
			[cancelRequest]);
		return false;
	},
	/**
	 * Default
	 */
	"none": progressData => {
		// Nothing has happened yet.
		return true;
	}
};

function init(data)
{
	progressDialog(
		translate("Initializing mod.io interface."),
		translate("Initializing"),
		false,
		translate("Cancel"),
		closePage);

	g_Failure = false;
	Engine.ModIoStartGetGameId();
}

function onTick()
{
	let progressData = Engine.ModIoGetDownloadProgress();

	let handler = g_ModIOState[progressData.status];
	if (!handler)
	{
		warn("Unrecognized progress status: " + progressData.status);
		return;
	}

	if (handler(progressData))
		Engine.ModIoAdvanceRequest();
}

function displayMods()
{
	let modsAvailableList = Engine.GetGUIObjectByName("modsAvailableList");
	let selectedMod = modsAvailableList.list[modsAvailableList.selected];
	modsAvailableList.selected = -1;

	let displayedMods = clone(g_ModsAvailableOnline);
	for (let i = 0; i < displayedMods.length; ++i)
		displayedMods[i].i = i;

	let filterColumns = ["name", "name_id", "summary"];
	let filterText = Engine.GetGUIObjectByName("modFilter").caption.toLowerCase();
	if (Engine.GetGUIObjectByName("compatibilityFilter").checked)
		displayedMods = displayedMods.filter(mod => !mod.invalid);
	displayedMods = displayedMods.filter(mod => filterColumns.some(column => mod[column].toLowerCase().indexOf(filterText) != -1));

	displayedMods.sort((mod1, mod2) =>
		modsAvailableList.selected_column_order *
		(modsAvailableList.selected_column == "filesize" ?
			mod1.filesize - mod2.filesize :
			String(mod1[modsAvailableList.selected_column]).localeCompare(String(mod2[modsAvailableList.selected_column]))));

	let updateAvailable = displayedMods.map(mod => isUpdateAvailable(mod.name_id, mod.version));
	let dependenciesMet = displayedMods.map(mod => areDependenciesMet(mod.dependencies));
	let updateIds = displayedMods.map(mod => mod.i);
	modsAvailableList.list_name = displayedMods.map(mod => colorModIO(mod.name, !mod.invalid, updateAvailable[updateIds.indexOf(mod.i)], isOwnedMod(mod.name_id), dependenciesMet[updateIds.indexOf(mod.i)]));
	modsAvailableList.list_name_id = displayedMods.map(mod => colorModIO(mod.name_id, !mod.invalid, updateAvailable[updateIds.indexOf(mod.i)], isOwnedMod(mod.name_id), dependenciesMet[updateIds.indexOf(mod.i)]));
	modsAvailableList.list_version = displayedMods.map(mod => colorModIO(mod.version || "", !mod.invalid, updateAvailable[updateIds.indexOf(mod.i)], isOwnedMod(mod.name_id), dependenciesMet[updateIds.indexOf(mod.i)]));
	modsAvailableList.list_filesize = displayedMods.map(mod => colorModIO(mod.filesize !== undefined ? filesizeToString(mod.filesize) : filesizeToString(mod.filesize), !mod.invalid, updateAvailable[updateIds.indexOf(mod.i)], isOwnedMod(mod.name_id), dependenciesMet[updateIds.indexOf(mod.i)]));
	modsAvailableList.list_dependencies = displayedMods.map(mod => colorModIO((mod.dependencies || []).join(" "), !mod.invalid, updateAvailable[updateIds.indexOf(mod.i)], isOwnedMod(mod.name_id), dependenciesMet[updateIds.indexOf(mod.i)]));
	modsAvailableList.list = displayedMods.map(mod => mod.i);
	modsAvailableList.selected = modsAvailableList.list.indexOf(selectedMod);
}

function versionUpdate(version1, version2)
{
	let versionList1 = version1.split(/[-_]/)[0].split(/\./g);
	let versionList2 = version2.split(/[-_]/)[0].split(/\./g);

	for (let i = 0; i < Math.min(versionList1.length, versionList2.length); ++i)
	{
		let diff = +versionList1[i] - +versionList2[i];
		if (diff > 0)
			return true;
		if (diff < 0)
			return false;
	}

	// common prefix matches
	let ldiff = versionList1.length - versionList2.length;
	return ldiff && ldiff >= 0;
}

function isUpdateAvailable(name, version)
{
	const mod = g_Mods[name];
	if (!!mod && !!mod.version)
		return versionUpdate(version, mod.version);
	return false;
}

function areDependenciesMet(dependencies)
{
	if (!!dependencies)	{
		for (let dependency of dependencies) {
			if (!isDependencyMet(dependency))
				return false;
		}
	}
	return true;
}

/**
 * @param dependency is a mod name or a mod version comparison.
 */
function isDependencyMet(dependency)
{
	let operator = dependency.match(g_RegExpComparisonOperator);
	let [name, version] = operator ? dependency.split(operator[0]) : [dependency, undefined];

	for (const i in g_Mods) {
		const mod = g_Mods[i];
		if (mod.name == name && (!operator || versionSatisfied(mod.version, operator[0], version)))
			return true;
	}
	return false;
}

/**
 * Compares the given versions using the given operator.
 *       '-' or '_' is ignored. Only numbers are supported.
 * @note "5.3" < "5.3.0"
 */
function versionSatisfied(version1, operator, version2)
{
	let versionList1 = version1.split(/[-_]/)[0].split(/\./g);
	let versionList2 = version2.split(/[-_]/)[0].split(/\./g);

	let eq = operator.indexOf("=") != -1;
	let lt = operator.indexOf("<") != -1;
	let gt = operator.indexOf(">") != -1;

	for (let i = 0; i < Math.min(versionList1.length, versionList2.length); ++i)
	{
		let diff = +versionList1[i] - +versionList2[i];

		if (gt && diff > 0 || lt && diff < 0)
			return true;

		if (gt && diff < 0 || lt && diff > 0 || eq && diff)
			return false;
	}

	// common prefix matches
	let ldiff = versionList1.length - versionList2.length;
	if (!ldiff)
		return eq;

	// NB: 2.3 != 2.3.0
	if (ldiff < 0)
		return lt;

	return gt;
}

function isOwnedMod(name)
{
	return !!g_Mods && !!g_Mods[name];
}
const g_RegExpComparisonOperator = /(<=|>=|<|>|=)/;
function getModIOColor(valid, update, owned, dependencies)
{
	return !valid ? "gray" : !dependencies ? "red" : update ? "yellow" : owned ? "green" :  false;
}

function colorModIO(text, valid, update, owned, dependencies)
{	
	const color = getModIOColor(valid, update, owned, dependencies);
	return color ? coloredText(text, color) : text;
}

function clearModList()
{
	let modsAvailableList = Engine.GetGUIObjectByName("modsAvailableList");
	modsAvailableList.selected = -1;
	modsAvailableList.list_name = [];
	modsAvailableList.list_name_id = [];
	modsAvailableList.list_version = [];
	modsAvailableList.list_filesize = [];
	modsAvailableList.list_dependencies = [];
	modsAvailableList.list = [];
}

function selectedModIndex()
{
	let modsAvailableList = Engine.GetGUIObjectByName("modsAvailableList");

	if (modsAvailableList.selected == -1)
		return undefined;

	return +modsAvailableList.list[modsAvailableList.selected];
}

function isSelectedModInvalid(selected)
{
	return selected !== undefined && !!g_ModsAvailableOnline[selected].invalid && g_ModsAvailableOnline[selected].invalid == "true";
}

function showModDescription()
{
	const selected = selectedModIndex();
	const isSelected = selected !== undefined;
	const isInvalid = isSelectedModInvalid(selected);
	let warningString = "";
	let infoString = "";
	if (isSelected && !isInvalid) {
		const mod = g_ModsAvailableOnline[selected];
		const isUpdate = isUpdateAvailable(mod.name_id, mod.version);
		const isDep = areDependenciesMet(mod.dependencies);
		if (!isDep) {
			warningString = coloredText("(Warning: " + "Dependencies might not be met." + ") ", "yellow");
		}
		if (isUpdate) {
			infoString  = coloredText("(Info: " + "Update is available" + ") ", "yellow");
		}
	}
	Engine.GetGUIObjectByName("downloadButton").enabled = isSelected && !isInvalid;
	Engine.GetGUIObjectByName("modDescription").caption = isSelected && !isInvalid ? warningString + infoString + g_ModsAvailableOnline[selected].summary : "";
	Engine.GetGUIObjectByName("modError").caption = isSelected && isInvalid ? sprintf(translate("Invalid mod: %(error)s"), {"error": g_ModsAvailableOnline[selected].error }) : "";
}

function cancelModListUpdate()
{
	cancelRequest();

	if (!g_ModsAvailableOnline.length)
	{
		closePage();
		return;
	}

	displayMods();
	Engine.GetGUIObjectByName('refreshButton').enabled = true;
}

function updateModList()
{
	clearModList();
	g_Mods = Engine.GetAvailableMods();
	Engine.GetGUIObjectByName("refreshButton").enabled = false;

	progressDialog(
		translate("Fetching and updating list of available mods."),
		translate("Updating"),
		false,
		translate("Cancel Update"),
		cancelModListUpdate);

	g_Failure = false;
	g_RequestCancelled = false;
	Engine.ModIoStartListMods();
}

function downloadMod()
{
	let selected = selectedModIndex();

	if (isSelectedModInvalid(selected))
		return;

	progressDialog(
		sprintf(translate("Downloading ???%(modname)s???"), {
			"modname": g_ModsAvailableOnline[selected].name
		}),
		translate("Downloading"),
		true,
		translate("Cancel Download"),
		() => { Engine.GetGUIObjectByName("downloadButton").enabled = true; });

	Engine.GetGUIObjectByName("downloadButton").enabled = false;

	g_Failure = false;
	g_RequestCancelled = false;
	Engine.ModIoStartDownloadMod(selected);
}

function cancelRequest()
{
	g_Failure = false;
	g_RequestCancelled = true;
	Engine.ModIoCancelRequest();
	hideDialog();
}

function closePage()
{
	Engine.PopGuiPage();
}

function showErrorMessageBox(caption, title, buttonCaptions, buttonActions)
{
	if (g_Failure)
		return;

	messageBox(500, 250, caption, title, buttonCaptions, buttonActions);
	g_Failure = true;
}

function progressDialog(dialogCaption, dialogTitle, showProgressBar, buttonCaption, buttonAction)
{
	Engine.GetGUIObjectByName("downloadDialog_title").caption = dialogTitle;

	let downloadDialog_caption = Engine.GetGUIObjectByName("downloadDialog_caption");
	downloadDialog_caption.caption = dialogCaption;

	let size = downloadDialog_caption.size;
	size.rbottom = showProgressBar ? 40 : 80;
	downloadDialog_caption.size = size;

	Engine.GetGUIObjectByName("downloadDialog_progress").hidden = !showProgressBar;
	Engine.GetGUIObjectByName("downloadDialog_status").hidden = !showProgressBar;

	let downloadDialog_button = Engine.GetGUIObjectByName("downloadDialog_button");
	downloadDialog_button.caption = buttonCaption;
	downloadDialog_button.onPress = () => { cancelRequest(); buttonAction(); };

	Engine.GetGUIObjectByName("downloadDialog").hidden = false;

	g_RequestStartTime = Date.now();
}

/*
 * The "remaining time" and "average speed" texts both naively assume that
 * the connection remains relatively stable throughout the download.
 */
function updateProgressBar(progress, totalSize)
{
	let progressPercent = Math.ceil(progress * 100);
	Engine.GetGUIObjectByName("downloadDialog_progressBar").progress = progressPercent;

	let transferredSize = progress * totalSize;
	let transferredSizeObj = filesizeToObj(transferredSize);
	// Translation: Mod file download indicator. Current size over expected final size, with percentage complete.
	Engine.GetGUIObjectByName("downloadDialog_progressText").caption = sprintf(translate("%(current)s / %(total)s (%(percent)s%%)"), {
		"current": filesizeToObj(totalSize).unit == transferredSizeObj.unit ? transferredSizeObj.filesize : filesizeToString(transferredSize),
		"total": filesizeToString(totalSize),
		"percent": progressPercent
	});

	let elapsedTime = Date.now() - g_RequestStartTime;
	let remainingTime = progressPercent ? (100 - progressPercent) * elapsedTime / progressPercent : 0;
	let avgSpeed = filesizeToObj(transferredSize / (elapsedTime / 1000));
	// Translation: Mod file download status message.
	Engine.GetGUIObjectByName("downloadDialog_status").caption = sprintf(translate("Time Elapsed: %(elapsed)s\nEstimated Time Remaining: %(remaining)s\nAverage Speed: %(avgSpeed)s"), {
		"elapsed": timeToString(elapsedTime),
		"remaining": remainingTime ? timeToString(remainingTime) : translate("???"),
		// Translation: Average download speed, used to give the user a very rough and naive idea of the download time. For example: 123.4 KiB/s
		"avgSpeed": sprintf(translate("%(number)s %(unit)s/s"), {
			"number": avgSpeed.filesize,
			"unit": avgSpeed.unit
		})
	});
}

function hideDialog()
{
	Engine.GetGUIObjectByName("downloadDialog").hidden = true;
}
