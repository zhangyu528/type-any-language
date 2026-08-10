"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { TiltCard, AnimatedCounter, Particles, GlowCard, ScrollReveal } from "@/components/effects"

export default function ComponentsDemo() {
  const [progress, setProgress] = React.useState(68)

  React.useEffect(() => {
    const timer = setTimeout(() => setProgress(68), 500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Particle background */}
      <Particles count={40} className="opacity-60" />

      <div className="relative z-10 mx-auto max-w-4xl space-y-8 px-6 py-16">
        {/* Header */}
        <ScrollReveal>
          <div className="space-y-2">
            <Badge variant="slate">TAL Slate</Badge>
            <h1 className="font-display text-3xl font-semibold text-foreground">
              Components Demo
            </h1>
            <p className="text-sm text-muted-foreground">
              shadcn/ui + React Bits + Tailwind CSS, all mapped to the TAL design token system.
            </p>
          </div>
        </ScrollReveal>

        <Separator />

        {/* Buttons */}
        <ScrollReveal delay={100}>
          <Card>
            <CardHeader>
              <CardTitle>Button</CardTitle>
              <CardDescription>6 variants, 4 sizes, mapped to --ds-action-deep</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Badges */}
        <ScrollReveal delay={150}>
          <Card>
            <CardHeader>
              <CardTitle>Badge</CardTitle>
              <CardDescription>Including custom mint &amp; coral variants</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="slate">CET-4</Badge>
              <Badge variant="amber">CET-6</Badge>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Progress + Counter */}
        <ScrollReveal delay={200}>
          <Card>
            <CardHeader>
              <CardTitle>Progress &amp; Animated Counter</CardTitle>
              <CardDescription>Number count-up with cubic ease-out, progress bar with fill animation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">课程进度</span>
                  <span className="font-mono text-sm text-primary">
                    <AnimatedCounter value={68} suffix="%" />
                  </span>
                </div>
                <Progress value={progress} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="font-display text-3xl font-semibold text-slate-deep">
                    <AnimatedCounter value={92} suffix="%" />
                  </div>
                  <div className="text-xs text-muted-foreground">正确率</div>
                </div>
                <div className="text-center">
                  <div className="font-display text-3xl font-semibold text-amber">
                    <AnimatedCounter value={48} />
                  </div>
                  <div className="text-xs text-muted-foreground">本周句数</div>
                </div>
                <div className="text-center">
                  <div className="font-display text-3xl font-semibold text-primary">
                    <AnimatedCounter value={156} />
                  </div>
                  <div className="text-xs text-muted-foreground">本周新词</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Tilt Card + Glow Card */}
        <ScrollReveal delay={250}>
          <div className="grid gap-4 md:grid-cols-2">
            <TiltCard className="rounded-lg">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Tilt Card</CardTitle>
                  <CardDescription>Move mouse over this card</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    3D perspective tilt with glare effect, powered by React Bits pattern.
                  </p>
                </CardContent>
              </Card>
            </TiltCard>

            <GlowCard className="rounded-lg">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Glow Card</CardTitle>
                  <CardDescription>Hover for glow spotlight</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Mouse-following radial glow using --ds-action color.
                  </p>
                </CardContent>
              </Card>
            </GlowCard>
          </div>
        </ScrollReveal>

        {/* Tabs */}
        <ScrollReveal delay={300}>
          <Card>
            <CardHeader>
              <CardTitle>Tabs</CardTitle>
              <CardDescription>Radix UI tabs with TAL styling</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="tab1">
                <TabsList>
                  <TabsTrigger value="tab1">Landing</TabsTrigger>
                  <TabsTrigger value="tab2">Dashboard</TabsTrigger>
                  <TabsTrigger value="tab3">Practice</TabsTrigger>
                </TabsList>
                <TabsContent value="tab1" className="mt-4">
                  <p className="text-sm text-muted-foreground">Landing page content here.</p>
                </TabsContent>
                <TabsContent value="tab2" className="mt-4">
                  <p className="text-sm text-muted-foreground">Dashboard content here.</p>
                </TabsContent>
                <TabsContent value="tab3" className="mt-4">
                  <p className="text-sm text-muted-foreground">Practice content here.</p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </ScrollReveal>

        {/* Tooltip */}
        <ScrollReveal delay={350}>
          <Card>
            <CardHeader>
              <CardTitle>Tooltip</CardTitle>
              <CardDescription>Hover the button to see tooltip</CardDescription>
            </CardHeader>
            <CardContent>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">Hover me</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Powered by Radix UI + TAL tokens</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardContent>
          </Card>
        </ScrollReveal>
      </div>
    </div>
  )
}
