/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { findLast } from '../../../../../base/common/arraysFind.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { asCssVariable } from '../../../../../platform/theme/common/colorUtils.js';
import { ChatConfiguration, ChatProgressAnimation } from '../../common/constants.js';
import { chatWorkingProgressInsidersIconForeground, chatWorkingProgressStableIconForeground } from '../../common/widget/chatColors.js';
import { CHAT_WORKING_LOGO_DRAW_PAINT_ORDER, ChatWorkingLogoDrawBand, getChatWorkingLogoDrawFrame } from './chatWorkingLogoDraw.js';
import './media/chatWorkingLogo.css';

/** SI Code mark (the S) in the chat working-logo viewBox. */
const facePaths = [
	'M26 26H70V36H36V48H26Z',
	'M26 43H70V53H26Z',
	'M60 43H70V70H26V60H60Z',
] as const;

let drawMaskIdPool = 0;

function isDrawAnimation(animation: ChatProgressAnimation): boolean {
	return animation === ChatProgressAnimation.Draw || animation === ChatProgressAnimation.DrawMonochrome;
}

function observeVisibility(element: HTMLElement, onDidChange: (visible: boolean) => void, intersectionObserver?: typeof IntersectionObserver): IDisposable {
	let disposed = false;
	let observer: IntersectionObserver | undefined;
	let visibilityListener: IDisposable | undefined;
	onDidChange(false);
	queueMicrotask(() => {
		if (disposed) {
			return;
		}
		const targetWindow = getWindow(element);
		const Observer = intersectionObserver ?? targetWindow.IntersectionObserver;
		if (typeof Observer !== 'function') {
			onDidChange(true);
			return;
		}
		let intersecting = false;
		const update = () => onDidChange(!targetWindow.document.hidden && intersecting);
		observer = new Observer(entries => {
			const entry = findLast(entries, entry => entry.target === element);
			if (entry) {
				intersecting = entry.isIntersecting;
				update();
			}
		});
		visibilityListener = addDisposableListener(targetWindow.document, 'visibilitychange', update);
		observer.observe(element);
	});
	return toDisposable(() => {
		disposed = true;
		observer?.disconnect();
		visibilityListener?.dispose();
	});
}

/** Animates the fixed product mark or the same mark assembled as one continuous ribbon. */
export class ChatWorkingLogo extends Disposable {
	readonly domNode: HTMLElement;
	readonly drawDurationMs = 2667;

	private animationFrame: MutableDisposable<IDisposable> | undefined;
	private drawPaths: Map<ChatWorkingLogoDrawBand, SVGPathElement> | undefined;
	private drawPathData: Map<ChatWorkingLogoDrawBand, string> | undefined;
	private readonly now: () => number;
	private readonly scheduleFrame: (targetWindow: Window, runner: () => void) => IDisposable;
	private readonly isMotionReducedOverride: (() => boolean) | undefined;
	private animation = ChatProgressAnimation.Off;
	private active = false;
	private visible = false;
	private animationStartedAt = 0;

	constructor(
		animation: ChatProgressAnimation,
		quality: 'stable' | 'insider' = 'stable',
		animationOptions: {
			readonly now?: () => number;
			readonly scheduleFrame?: (targetWindow: Window, runner: () => void) => IDisposable;
			readonly isMotionReduced?: () => boolean;
			readonly observeVisibility?: (element: HTMLElement, onDidChange: (visible: boolean) => void) => IDisposable;
			readonly intersectionObserver?: typeof IntersectionObserver;
		} = {},
	) {
		super();
		this.domNode = $('span.chat-working-logo', { 'aria-hidden': 'true' });
		this.domNode.style.color = asCssVariable(quality === 'insider' ? chatWorkingProgressInsidersIconForeground : chatWorkingProgressStableIconForeground);
		this.now = animationOptions.now ?? (() => getWindow(this.domNode).performance.now());
		this.scheduleFrame = animationOptions.scheduleFrame ?? ((targetWindow, runner) => {
			const handle = targetWindow.requestAnimationFrame(runner);
			return toDisposable(() => targetWindow.cancelAnimationFrame(handle));
		});
		this.isMotionReducedOverride = animationOptions.isMotionReduced;

		const wrapper = append(this.domNode, $('span.chat-working-logo-face'));
		wrapper.appendChild($.SVG<SVGSVGElement>('svg', { viewBox: '6 6 84 84', width: '100%', height: '100%', focusable: 'false' },
			...facePaths.map(path => $.SVG<SVGPathElement>('path', { d: path, fill: 'currentColor' }))));
		const visibilityObserver: typeof observeVisibility = animationOptions.observeVisibility ?? observeVisibility;
		this._register(visibilityObserver(this.domNode, visible => {
			if (this.visible !== visible) {
				this.visible = visible;
				this.restartDrawAnimation();
			}
		}, animationOptions.intersectionObserver));
		this.setAnimation(animation);
		this.setActive(true);
	}

	setAnimation(animation: ChatProgressAnimation): void {
		const noIcon = animation === ChatProgressAnimation.DrawMonochromeNoIcon;
		const draw = isDrawAnimation(animation);
		if (draw) {
			this.ensureDrawArtwork();
		}
		this.animation = animation;
		this.domNode.classList.toggle('chat-working-logo-draw', draw);
		this.domNode.classList.toggle('chat-working-logo-monochrome', animation === ChatProgressAnimation.DrawMonochrome || noIcon);
		this.domNode.classList.toggle('chat-working-logo-no-icon', noIcon);
		this.domNode.dataset.animation = animation;
		this.restartDrawAnimation();
	}

	setActive(active: boolean): void {
		if (this.active === active) {
			return;
		}
		this.active = active;
		this.domNode.classList.toggle('chat-working-logo-active', active);
		this.restartDrawAnimation();
	}

	protected refreshMotion(): void {
		this.restartDrawAnimation();
	}

	override dispose(): void {
		this.domNode.remove();
		super.dispose();
	}

	private ensureDrawArtwork(): void {
		if (this.drawPaths) {
			return;
		}
		this.animationFrame = this._register(new MutableDisposable());
		this.drawPaths = new Map();
		this.drawPathData = new Map();
		const maskId = ++drawMaskIdPool;
		const defs = $.SVG<SVGDefsElement>('defs');
		const artwork = $.SVG<SVGGElement>('g', { class: 'chat-working-logo-draw-artwork' });
		for (let index = 0; index < CHAT_WORKING_LOGO_DRAW_PAINT_ORDER.length; index++) {
			const band = CHAT_WORKING_LOGO_DRAW_PAINT_ORDER[index];
			const maskPath = $.SVG<SVGPathElement>('path', {
				class: `chat-working-logo-draw-band chat-working-logo-draw-band-${band}`,
				fill: '#fff',
				stroke: '#fff',
				'stroke-width': '4',
				'stroke-linejoin': 'round',
				transform: 'translate(6 6) scale(0.84)',
			});
			const mask = $.SVG<SVGMaskElement>('mask', {
				id: `chat-working-logo-draw-mask-${maskId}-${band}`,
				x: '0',
				y: '0',
				width: '96',
				height: '96',
				maskUnits: 'userSpaceOnUse',
				'mask-type': 'alpha',
			}, maskPath);
			const renderedFace = $.SVG<SVGPathElement>('path', {
				class: `chat-working-logo-draw-face chat-working-logo-draw-face-${band}`,
				d: facePaths[index],
				fill: 'currentColor',
				mask: `url(#chat-working-logo-draw-mask-${maskId}-${band})`,
			});
			defs.appendChild(mask);
			artwork.appendChild(renderedFace);
			this.drawPaths.set(band, maskPath);
		}
		const wrapper = append(this.domNode, $('span.chat-working-logo-draw-container'));
		wrapper.appendChild($.SVG<SVGSVGElement>('svg', {
			viewBox: '6 6 84 84',
			width: '100%',
			height: '100%',
			focusable: 'false',
			'shape-rendering': 'geometricPrecision',
		}, defs, artwork));
		this.renderDrawFrame(0.5);
	}

	private restartDrawAnimation(): void {
		this.animationFrame?.clear();
		if (!isDrawAnimation(this.animation)) {
			return;
		}
		if (!this.active || this.isMotionReduced()) {
			this.renderDrawFrame(0.5);
			return;
		}
		if (!this.visible) {
			return;
		}
		this.animationStartedAt = this.now();
		this.renderDrawFrame(0);
		this.queueAnimationFrame();
	}

	private queueAnimationFrame(): void {
		const animationFrame = this.animationFrame;
		if (!animationFrame || animationFrame.value || !this.active || !this.visible || !isDrawAnimation(this.animation)) {
			return;
		}
		animationFrame.value = this.scheduleFrame(getWindow(this.domNode), () => {
			animationFrame.clear();
			this.renderNextDrawFrame();
		});
	}

	private renderNextDrawFrame(): void {
		if (!this.active || !this.visible || !isDrawAnimation(this.animation)) {
			return;
		}
		if (this.isMotionReduced()) {
			this.renderDrawFrame(0.5);
			return;
		}
		this.renderDrawFrame(((this.now() - this.animationStartedAt) % this.drawDurationMs) / this.drawDurationMs);
		this.queueAnimationFrame();
	}

	private renderDrawFrame(progress: number): void {
		if (!this.drawPaths) {
			return;
		}
		const frame = getChatWorkingLogoDrawFrame(progress);
		this.domNode.classList.toggle('chat-working-logo-draw-assembled', frame.assembled);
		if (frame.assembled) {
			return;
		}
		for (const band of CHAT_WORKING_LOGO_DRAW_PAINT_ORDER) {
			const pathData = frame.paths[band];
			if (this.drawPathData?.get(band) === pathData) {
				continue;
			}
			this.drawPaths.get(band)?.setAttribute('d', pathData);
			this.drawPathData?.set(band, pathData);
		}
	}

	private isMotionReduced(): boolean {
		// Component fixtures freeze all motion with `.disable-animations`, even when they opt into motion.
		if (this.domNode.closest('.disable-animations')) {
			return true;
		}
		if (this.domNode.closest('.monaco-enable-motion')) {
			return false;
		}
		if (this.domNode.closest('.monaco-reduce-motion')) {
			return true;
		}
		return this.isMotionReducedOverride?.() ?? getWindow(this.domNode).matchMedia('(prefers-reduced-motion: reduce)').matches;
	}
}

export class ChatWorkingProgressLogo extends ChatWorkingLogo {
	constructor(
		quality: 'stable' | 'insider',
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super(getConfiguredProgressAnimation(configurationService, logService), quality, {
			isMotionReduced: () => accessibilityService.isMotionReduced(),
		});
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(ChatConfiguration.PersistentProgress)) {
				this.setAnimation(getConfiguredProgressAnimation(configurationService, logService));
			}
		}));
		this._register(accessibilityService.onDidChangeReducedMotion(() => this.refreshMotion()));
	}
}

const warnedUnsupportedAnimations = new Set<string>();

export function getConfiguredProgressAnimation(configurationService: IConfigurationService, logService: ILogService): ChatProgressAnimation {
	const animation = configurationService.getValue<string | undefined>(ChatConfiguration.PersistentProgress);
	switch (animation) {
		case undefined:
			return ChatProgressAnimation.Off;
		case ChatProgressAnimation.Off:
		case ChatProgressAnimation.Draw:
		case ChatProgressAnimation.DrawMonochrome:
		case ChatProgressAnimation.DrawMonochromeNoIcon:
			return animation;
		case 'ribbon':
		case 'weave':
		case 'orbit':
		case 'accordion':
		case 'dial':
			return ChatProgressAnimation.Draw;
		default: {
			// Resolved on render hot paths, so an unknown value (e.g. from an experiment targeting a newer
			// client) must not warn on every call.
			const key = String(animation);
			if (!warnedUnsupportedAnimations.has(key)) {
				warnedUnsupportedAnimations.add(key);
				logService.warn('ChatWorkingProgressLogo: unsupported progress animation, using Off', animation);
			}
			return ChatProgressAnimation.Off;
		}
	}
}
